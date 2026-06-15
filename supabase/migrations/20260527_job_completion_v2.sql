-- Job completion RPC v2 — returns the full updated jobs row.
--
-- Replaces the text-returning v1 (which was never applied to production).
-- The client reads status, owner_completed_at, buddy_completed_at from the
-- returned row to update local state without a separate re-fetch.
--
-- Auth rules (SECURITY DEFINER / BYPASSRLS):
--   Caller must be creator_id (owner) OR assigned_buddy_id.
--   Sets owner_completed_at or buddy_completed_at accordingly (idempotent).
--   When both timestamps are present: status → 'completed', completed_at set.

-- ── Schema (idempotent) ──────────────────────────────────────────────────────

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS owner_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS buddy_completed_at timestamptz;

-- ── RPC ──────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.confirm_job_completion(uuid);

CREATE FUNCTION public.confirm_job_completion(p_job_id uuid)
RETURNS public.jobs
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
  v_result      public.jobs;
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

  -- Rate limit: 20 completions per day per user (M-1 protection)
  IF NOT public.check_rate_limit(v_caller_id, 'job_complete', 20, 86400) THEN
    RAISE EXCEPTION 'rate_limit_exceeded' USING ERRCODE = 'P0001';
  END IF;

  -- Identity verification required (Phase 1)
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_caller_id
      AND p.identity_verified_at IS NOT NULL
      AND p.verification_status = 'approved'
  ) THEN
    RAISE EXCEPTION 'identity_verification_required' USING ERRCODE = 'P0001';
  END IF;

  IF v_caller_id = v_creator_id THEN
    IF v_owner_done IS NULL THEN
      UPDATE public.jobs
         SET owner_completed_at = now(), updated_at = now()
       WHERE id = p_job_id;
    END IF;
  ELSIF v_caller_id = v_assigned_id THEN
    IF v_buddy_done IS NULL THEN
      UPDATE public.jobs
         SET buddy_completed_at = now(), updated_at = now()
       WHERE id = p_job_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'not_job_participant' USING ERRCODE = 'P0001';
  END IF;

  -- Re-read timestamps after our UPDATE so both-confirmed check is fresh.
  SELECT owner_completed_at, buddy_completed_at
    INTO v_owner_done, v_buddy_done
    FROM public.jobs
   WHERE id = p_job_id;

  -- Both sides confirmed → finalize status.
  IF v_owner_done IS NOT NULL AND v_buddy_done IS NOT NULL THEN
    UPDATE public.jobs
       SET status       = 'completed',
           completed_at = COALESCE(completed_at, now()),
           updated_at   = now()
     WHERE id = p_job_id AND status <> 'completed';
  END IF;

  -- Return the authoritative row so the client can sync without a second fetch.
  SELECT * INTO v_result FROM public.jobs WHERE id = p_job_id;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_job_completion(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_job_completion(uuid) TO authenticated;
ALTER FUNCTION public.confirm_job_completion(uuid) OWNER TO postgres;

NOTIFY pgrst, 'reload schema';
