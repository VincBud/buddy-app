-- Harden job lifecycle RLS: WITH CHECK on job_applications and status
-- restrictions on jobs.
--
-- ── public.job_applications ────────────────────────────────────────────────────
--
-- Problem: "job_applications_update_owner" had USING but no WITH CHECK.
-- A job owner could send a PATCH with any column values — including changing
-- job_id, buddy_id, or reverting status from accepted/rejected back to pending.
--
-- Fix: add WITH CHECK that:
--   • Freezes job_id, buddy_id, created_at (verified against stored row).
--   • Restricts status to the enum values enforced by the CHECK constraint
--     (belt-and-suspenders: the DB constraint already blocks bad values, but
--     the RLS check ensures the policy is self-documenting and not silently
--     relying on a lower layer).
--   • Prevents reverting a finalised application (accepted/rejected) back to
--     pending — which would let an owner un-reject an application, reopen
--     competition, and potentially confuse the buddy.
--
-- WITH CHECK references old column values via correlated subquery against
-- public.job_applications because RLS WITH CHECK only sees the NEW row.
-- All NEW-row references are qualified with the table name to avoid ambiguity
-- with the aliased subquery rows.
-- If a client attempts to change job_id or buddy_id the subquery EXISTS
-- returns false, which fails the check.
--
-- ── public.jobs ────────────────────────────────────────────────────────────────
--
-- Problem: "jobs_update_own" WITH CHECK (creator_id = auth.uid()) left status
-- completely unrestricted. An owner could rewrite a completed or cancelled job
-- back to open/matched/active — bypassing any business-logic guards in the app.
--
-- Fix: add status restrictions:
--   • Status must be a known lifecycle value (same set as the app uses).
--   • completed and cancelled are terminal: cannot move back to
--     open / matched / active.
--   • All other forward/sideways transitions remain allowed (the app drives
--     the state machine; we only block clearly invalid reversions at the DB).
--
-- No app-code changes needed: syncJobToSupabase sends valid lifecycle values;
-- setApplicationStatus / rejectOtherPendingApplications only write
-- accepted / rejected (forward transitions).

-- ── job_applications ──────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "job_applications_update_owner" ON public.job_applications;

CREATE POLICY "job_applications_update_owner"
  ON public.job_applications FOR UPDATE
  USING (
    -- Only the job owner may target this row
    EXISTS (
      SELECT 1 FROM public.jobs
       WHERE public.jobs.id         = public.job_applications.job_id
         AND public.jobs.creator_id = auth.uid()
    )
  )
  WITH CHECK (
    -- Valid status value (mirrors the DB CHECK constraint)
    public.job_applications.status IN ('pending', 'accepted', 'rejected')

    -- Immutable columns: job_id, buddy_id, and created_at must not change.
    -- Correlated subquery reads the stored (OLD) row by NEW.id; if no row is
    -- found (e.g. id was changed) the EXISTS returns false.
    AND EXISTS (
      SELECT 1 FROM public.job_applications existing
       WHERE existing.id         = public.job_applications.id
         AND existing.job_id     = public.job_applications.job_id
         AND existing.buddy_id   = public.job_applications.buddy_id
         AND existing.created_at = public.job_applications.created_at
    )

    -- No reversion: once accepted or rejected a row may not go back to pending
    AND NOT (
      public.job_applications.status = 'pending'
      AND (
        SELECT existing.status
          FROM public.job_applications existing
         WHERE existing.id = public.job_applications.id
      ) IN ('accepted', 'rejected')
    )
  );

-- ── jobs ──────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "jobs_update_own" ON public.jobs;

CREATE POLICY "jobs_update_own"
  ON public.jobs FOR UPDATE
  USING  (public.jobs.creator_id = auth.uid())
  WITH CHECK (
    -- creator_id is immutable
    public.jobs.creator_id = auth.uid()

    -- Status must be a recognised lifecycle value
    AND public.jobs.status IN (
      'open', 'paused', 'matched', 'active',
      'issue_reported', 'completed', 'cancelled', 'expired'
    )

    -- Terminal states (completed, cancelled) may not revert to active states.
    -- Correlated subquery reads stored status by NEW.id; if the id was changed
    -- the subquery returns NULL and the NOT (...) condition is vacuously true,
    -- allowing the other constraints to handle the rejection.
    AND NOT (
      (
        SELECT j.status FROM public.jobs j WHERE j.id = public.jobs.id
      ) IN ('completed', 'cancelled')
      AND public.jobs.status IN ('open', 'matched', 'active')
    )
  );
