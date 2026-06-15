-- Guard against re-applying to a finalised job application.
--
-- Background: public.job_applications has UNIQUE(job_id, buddy_id) and the
-- client historically used .upsert(..., { onConflict: 'job_id,buddy_id' }).
-- A rejected or accepted buddy could craft a request that triggers the
-- ON CONFLICT DO UPDATE path and silently reset status to 'pending'.
-- The RLS UPDATE policy (job_applications_update_owner) already blocks
-- buddy-driven UPDATEs, but:
--
--   1. The error is indistinguishable from the expected 23505 "already pending"
--      case, making app-side error handling ambiguous.
--   2. Defense-in-depth: RLS alone is not a hard DB invariant; a future policy
--      change could re-open the gap.
--
-- Fix: BEFORE INSERT trigger that raises an explicit, stable error when the
-- (job_id, buddy_id) pair already exists with a terminal status.
-- Runs SECURITY DEFINER to read the current row regardless of RLS.
--
-- Error contract (consumed by job-requests.service.ts):
--   SQLSTATE  P0001   raise_exception
--   MESSAGE   'application_already_finalized'
--
-- Pending row: trigger allows the INSERT to pass through; the UNIQUE
-- constraint then raises 23505, which the service treats as idempotent.

CREATE OR REPLACE FUNCTION public.guard_job_application_finalized()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_status text;
BEGIN
  SELECT status
    INTO v_existing_status
    FROM public.job_applications
   WHERE job_id   = NEW.job_id
     AND buddy_id = NEW.buddy_id;

  IF FOUND AND v_existing_status IN ('accepted', 'rejected') THEN
    RAISE EXCEPTION 'application_already_finalized'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_job_application_finalized() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_guard_job_application_finalized
  ON public.job_applications;

CREATE TRIGGER trg_guard_job_application_finalized
  BEFORE INSERT ON public.job_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_job_application_finalized();
