-- READ-ONLY diagnostics for the payout / public-feed / completion bugs.
-- Safe to run at any time (no writes). Run BEFORE any cleanup.
--
-- NOTE ON WALLET TRANSACTIONS: the wallet ledger is client-side (AsyncStorage in
-- lib/wallet.ts) — there is no server wallet/payout table. Diagnostics about
-- "duplicate payouts", "both participants credited" and "invalid timestamps" are
-- therefore enforced/repaired in the app (assigned-helper guard, per-jobId
-- dedup, and date repair on load), not via SQL. The DB-side checks below cover
-- the *cause* data that drives payouts and feed visibility: job assignment and
-- application state. A job may only ever have ONE assigned helper, so more than
-- one accepted application is the DB signal for an ambiguous / double payout.

-- 1. Open jobs that already have an assigned helper (should be matched, not open).
SELECT j.id, j.creator_id, j.assigned_buddy_id, j.status, j.updated_at
  FROM public.jobs j
 WHERE j.status = 'open'
   AND j.assigned_buddy_id IS NOT NULL
 ORDER BY j.updated_at DESC;

-- 2. Open jobs that have an accepted application (should have left the public feed).
SELECT j.id, j.creator_id, j.status, acc.buddy_id AS accepted_buddy_id, acc.updated_at
  FROM public.jobs j
  JOIN public.job_applications acc ON acc.job_id = j.id AND acc.status = 'accepted'
 WHERE j.status = 'open'
 ORDER BY acc.updated_at DESC;

-- 3. Accepted application exists but the job has no assigned helper (broken assignment).
SELECT acc.job_id, acc.buddy_id, j.status, j.assigned_buddy_id
  FROM public.job_applications acc
  JOIN public.jobs j ON j.id = acc.job_id
 WHERE acc.status = 'accepted'
   AND j.assigned_buddy_id IS NULL
 ORDER BY acc.updated_at DESC;

-- 4. Jobs with MORE THAN ONE accepted application (ambiguous payout recipient —
--    the DB-level analogue of "a job with more than one positive payout").
SELECT acc.job_id, COUNT(*) AS accepted_count, array_agg(acc.buddy_id) AS buddies
  FROM public.job_applications acc
 WHERE acc.status = 'accepted'
 GROUP BY acc.job_id
HAVING COUNT(*) > 1;

-- 5. Jobs where the assigned helper does NOT match the accepted application
--    (payout would go to a user who was not the accepted helper).
SELECT j.id, j.assigned_buddy_id, acc.buddy_id AS accepted_buddy_id
  FROM public.jobs j
  JOIN public.job_applications acc ON acc.job_id = j.id AND acc.status = 'accepted'
 WHERE j.assigned_buddy_id IS NOT NULL
   AND j.assigned_buddy_id <> acc.buddy_id;

-- 6. Completed jobs without an assigned helper (a completion with no valid payout
--    recipient — the assigned helper is the only user who may be credited).
SELECT j.id, j.creator_id, j.status, j.completed_at
  FROM public.jobs j
 WHERE j.status = 'completed'
   AND j.assigned_buddy_id IS NULL
 ORDER BY j.completed_at DESC NULLS LAST;

-- 7. Assigned/finished jobs that would still pass a naive "status = 'open'" feed
--    filter (sanity check that hardening covers every non-public status).
SELECT j.status, COUNT(*)
  FROM public.jobs j
 WHERE j.status <> 'open'
 GROUP BY j.status
 ORDER BY j.status;
