-- Two-way server-backed job completion
--
-- Adds owner_completed_at / buddy_completed_at columns and an RPC that:
--   1. Sets the caller's timestamp (idempotent).
--   2. When both are set: transitions jobs.status → 'completed'.
--   3. Returns 'pending' or 'completed' so the client knows the final state.
--
-- SECURITY DEFINER (postgres / BYPASSRLS) because:
--   - RLS jobs_update_own only allows creator to UPDATE directly.
--   - The buddy has no direct UPDATE permission; they must go through this RPC.
--   - Auth is validated server-side: caller must be creator OR assigned_buddy_id.

-- ── Columns ───────────────────────────────────────────────────────────────────

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS owner_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS buddy_completed_at timestamptz;

-- ── RPC ───────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.confirm_job_completion(uuid);

CREATE FUNCTION public.confirm_job_completion(p_job_id uuid)
RETURNS text          -- 'pending' | 'completed'
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id   uuid;
  v_creator_id  uuid;
  v_assigned_id uuid;
  v_owner_done  timestamptz;
  v_buddy_done  timestamptz;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT creator_id, assigned_buddy_id, owner_completed_at, buddy_completed_at
    INTO v_creator_id, v_assigned_id, v_owner_done, v_buddy_done
    FROM public.jobs
   WHERE id = p_job_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_caller_id = v_creator_id THEN
    IF v_owner_done IS NULL THEN
      UPDATE public.jobs
         SET owner_completed_at = now(), updated_at = now()
       WHERE id = p_job_id;
      v_owner_done := now();
    END IF;
  ELSIF v_caller_id = v_assigned_id THEN
    IF v_buddy_done IS NULL THEN
      UPDATE public.jobs
         SET buddy_completed_at = now(), updated_at = now()
       WHERE id = p_job_id;
      v_buddy_done := now();
    END IF;
  ELSE
    RAISE EXCEPTION 'not_job_participant' USING ERRCODE = 'P0001';
  END IF;

  -- Both confirmed → finalize
  IF v_owner_done IS NOT NULL AND v_buddy_done IS NOT NULL THEN
    UPDATE public.jobs
       SET status       = 'completed',
           completed_at = COALESCE(completed_at, now()),
           updated_at   = now()
     WHERE id = p_job_id AND status <> 'completed';
    RETURN 'completed';
  END IF;

  RETURN 'pending';
END;
$$;

REVOKE ALL  ON FUNCTION public.confirm_job_completion(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_job_completion(uuid) TO authenticated;
ALTER FUNCTION public.confirm_job_completion(uuid) OWNER TO postgres;

NOTIFY pgrst, 'reload schema';
