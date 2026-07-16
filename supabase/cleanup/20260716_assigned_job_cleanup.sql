-- MANUAL cleanup for inconsistent assigned-job rows. DO NOT run automatically
-- and DO NOT add to supabase/migrations/. Review each preview before committing.
--
-- Scope: this repairs the DB *cause* data behind the public-feed and double-payout
-- bugs — jobs that are still 'open' although a helper was assigned or an
-- application was accepted. The forward migration
-- (20260716_geo_feed_hardening_and_repair.sql) already applies the same repair on
-- deploy; this script exists so the fix can be previewed/audited/rolled back
-- manually on production, and is idempotent (finds 0 rows once repaired).
--
-- WALLET LEDGER: transactions live client-side (AsyncStorage), NOT in Postgres,
-- so there are no wallet rows to delete or correct here. The app repairs wallet
-- state on next load: the assigned-helper guard stops any new owner/duplicate
-- credit, per-jobId dedup collapses duplicates, and invalid (1970) earning dates
-- are re-derived from the job's completion timestamp. No destructive SQL is
-- required or possible for the wallet — do not attempt it.

BEGIN;

-- ── 1. PREVIEW — inspect exactly what will change (run and read before proceeding)
-- 1a. Open jobs with an assigned helper → will become 'matched'.
SELECT 'open_with_assigned' AS bucket, j.id, j.creator_id, j.assigned_buddy_id, j.status
  FROM public.jobs j
 WHERE j.status = 'open'
   AND j.assigned_buddy_id IS NOT NULL;

-- 1b. Open jobs with an accepted application but no assigned helper → will be
--     assigned to the accepted helper and become 'matched'.
SELECT 'open_with_accepted_app' AS bucket, j.id, j.creator_id, acc.buddy_id AS accepted_buddy_id, j.status
  FROM public.jobs j
  JOIN public.job_applications acc ON acc.job_id = j.id AND acc.status = 'accepted'
 WHERE j.status = 'open'
   AND j.assigned_buddy_id IS NULL;

-- ── 2. REPAIR — apply corrections (non-destructive: status/assignment only) ────
UPDATE public.jobs j
   SET status = 'matched', updated_at = now()
 WHERE j.status = 'open'
   AND j.assigned_buddy_id IS NOT NULL;

UPDATE public.jobs j
   SET assigned_buddy_id = acc.buddy_id,
       status            = 'matched',
       updated_at        = now()
  FROM public.job_applications acc
 WHERE acc.job_id = j.id
   AND acc.status = 'accepted'
   AND j.status = 'open'
   AND j.assigned_buddy_id IS NULL;

-- ── 3. VALIDATE — these must all return ZERO rows after the repair ─────────────
SELECT 'remaining_open_with_assigned' AS check_name, COUNT(*) AS offending_rows
  FROM public.jobs j
 WHERE j.status = 'open' AND j.assigned_buddy_id IS NOT NULL;

SELECT 'remaining_open_with_accepted_app' AS check_name, COUNT(*) AS offending_rows
  FROM public.jobs j
  JOIN public.job_applications acc ON acc.job_id = j.id AND acc.status = 'accepted'
 WHERE j.status = 'open';

-- ── 4. COMMIT or ROLLBACK ──────────────────────────────────────────────────────
-- If the previews looked correct and both validation counts are 0, run:  COMMIT;
-- Otherwise run:  ROLLBACK;
ROLLBACK;  -- default safety: change to COMMIT only after reviewing the output above
