-- Assigned buddy column + RLS + updated review_job_application RPC
--
-- Problem: after owner accepts, the job status becomes 'matched' and is no
-- longer returned by the 'jobs_read_open' SELECT policy. The buddy has no
-- policy to read the job, so their device never sees the matched state.
-- assignedBuddyId was only in the JSONB payload — no column to index or RLS on.
--
-- Fix:
--   A. Add jobs.assigned_buddy_id uuid column.
--   B. Add jobs_read_assigned SELECT policy: assigned buddy can read their job.
--   C. Update review_job_application RPC to atomically set
--      jobs.status = 'matched' AND jobs.assigned_buddy_id = p_buddy_id on accept.

-- ── A. Column + index ─────────────────────────────────────────────────────────

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS assigned_buddy_id uuid
    REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS jobs_assigned_buddy_id_idx
  ON public.jobs (assigned_buddy_id);

-- ── B. RLS: accepted buddy can read their matched job ─────────────────────────

DROP POLICY IF EXISTS "jobs_read_assigned" ON public.jobs;

CREATE POLICY "jobs_read_assigned"
  ON public.jobs FOR SELECT
  USING (assigned_buddy_id = auth.uid());

-- ── C. review_job_application — also updates jobs row ────────────────────────
--
-- Same ownership/auth guards as before. On 'accepted':
--   1. Set job_applications.status = 'accepted' for the chosen buddy.
--   2. Set jobs.status = 'matched' and jobs.assigned_buddy_id = p_buddy_id.
--   3. Reject all other pending applications for the same job.
-- On 'rejected': only updates the application row (no job mutation).
-- AFTER UPDATE trigger on job_applications fires normally in both cases and
-- delivers jobApplicationAccepted / jobApplicationDeclined to the buddy.

-- Drop all known overloads (4-arg with p_note, 3-arg without)
DROP FUNCTION IF EXISTS public.review_job_application(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.review_job_application(uuid, uuid, text);

CREATE FUNCTION public.review_job_application(
  p_job_id   uuid,
  p_buddy_id uuid,
  p_decision text        -- 'accepted' or 'rejected'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id uuid;
BEGIN
  SELECT j.creator_id INTO v_owner_id
    FROM public.jobs j
   WHERE j.id = p_job_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_job_owner' USING ERRCODE = 'P0001';
  END IF;

  IF p_decision NOT IN ('accepted', 'rejected') THEN
    RAISE EXCEPTION 'invalid_decision' USING ERRCODE = 'P0001';
  END IF;

  -- Update target application — fires trg_notify_job_application_changes AFTER UPDATE
  UPDATE public.job_applications
     SET status = p_decision
   WHERE job_id   = p_job_id
     AND buddy_id = p_buddy_id;

  IF p_decision = 'accepted' THEN
    -- Atomically mark job as matched and set assigned buddy
    UPDATE public.jobs
       SET status            = 'matched',
           assigned_buddy_id = p_buddy_id,
           updated_at        = now()
     WHERE id = p_job_id;

    -- Reject all other pending applications for this job
    UPDATE public.job_applications
       SET status = 'rejected'
     WHERE job_id   = p_job_id
       AND buddy_id <> p_buddy_id
       AND status   = 'pending';
  END IF;
END;
$$;

REVOKE ALL  ON FUNCTION public.review_job_application(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_job_application(uuid, uuid, text) TO authenticated;
ALTER FUNCTION public.review_job_application(uuid, uuid, text) OWNER TO postgres;

NOTIFY pgrst, 'reload schema';
