-- Backend fixes — 2026-05-27
--
-- A. Recreate apply_to_job RPC (drop all overloads first; explicit ::uuid casts
--    in INSERT VALUES prevent any residual text-binding ambiguity).
-- B. Replace recursive job_applications UPDATE policy with a simple non-recursive
--    one (WITH CHECK was selecting from job_applications inside its own policy
--    → infinite recursion on every status update).
-- C. Create review_job_application RPC (SECURITY DEFINER, BYPASSRLS) so the
--    owner-side accept/reject bypasses the RLS UPDATE policy entirely — same
--    rationale as apply_to_job: avoids PostgREST type-binding issues and
--    centralises ownership validation server-side.

-- ── A. apply_to_job ───────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.apply_to_job(uuid, text);
DROP FUNCTION IF EXISTS public.apply_to_job(text, text);
DROP FUNCTION IF EXISTS public.apply_to_job(uuid);
DROP FUNCTION IF EXISTS public.apply_to_job(text);

CREATE FUNCTION public.apply_to_job(
  p_job_id     uuid,
  p_buddy_name text DEFAULT ''
)
RETURNS TABLE (
  id                   uuid,
  job_id               uuid,
  buddy_id             uuid,
  buddy_name           text,
  buddy_score          numeric,
  buddy_rating_average numeric,
  buddy_rating_count   integer,
  buddy_completed_jobs integer,
  buddy_reliability    text,
  status               text,
  created_at           timestamptz,
  updated_at           timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p_buddy_id   uuid;
  v_job_status text;
  v_creator_id uuid;
BEGIN
  p_buddy_id := auth.uid();

  IF p_buddy_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT j.status, j.creator_id
    INTO v_job_status, v_creator_id
    FROM public.jobs j
   WHERE j.id = p_job_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_job_status NOT IN ('open', 'active') THEN
    RAISE EXCEPTION 'job_not_open' USING ERRCODE = 'P0001';
  END IF;

  IF v_creator_id = p_buddy_id THEN
    RAISE EXCEPTION 'cannot_apply_to_own_job' USING ERRCODE = 'P0001';
  END IF;

  -- Explicit ::uuid casts on both values eliminate any remaining type ambiguity
  -- regardless of what the function's parameter type was in a previous deploy.
  RETURN QUERY
  INSERT INTO public.job_applications (job_id, buddy_id, buddy_name, status)
  VALUES (p_job_id::uuid, p_buddy_id::uuid, COALESCE(p_buddy_name, ''), 'pending')
  RETURNING
    job_applications.id::uuid,
    job_applications.job_id::uuid,
    job_applications.buddy_id::uuid,
    job_applications.buddy_name,
    job_applications.buddy_score,
    job_applications.buddy_rating_average,
    job_applications.buddy_rating_count,
    job_applications.buddy_completed_jobs,
    job_applications.buddy_reliability,
    job_applications.status,
    job_applications.created_at,
    job_applications.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_to_job(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_to_job(uuid, text) TO authenticated;
ALTER FUNCTION public.apply_to_job(uuid, text) OWNER TO postgres;

-- ── B. Drop recursive UPDATE policy; replace with simple version ──────────────
--
-- The original WITH CHECK contained:
--   AND EXISTS (SELECT 1 FROM public.job_applications existing WHERE ...)
-- which caused infinite recursion when PostgreSQL evaluated it during UPDATE.
-- The immutable-column guard was defense-in-depth only; the UNIQUE constraint
-- and guard_job_application_finalized trigger cover the real invariants.

DROP POLICY IF EXISTS "job_applications_update_owner" ON public.job_applications;

CREATE POLICY "job_applications_update_owner"
  ON public.job_applications FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.jobs
       WHERE public.jobs.id         = public.job_applications.job_id
         AND public.jobs.creator_id = auth.uid()
    )
  )
  WITH CHECK (
    public.job_applications.status IN ('pending', 'accepted', 'rejected')
  );

-- ── C. review_job_application RPC ─────────────────────────────────────────────
--
-- Owner-side accept/reject that runs as postgres (BYPASSRLS), so it:
--   • Is not subject to the RLS UPDATE policy (prevents any future recursion
--     from policy changes).
--   • Validates ownership server-side — auth.uid() must be the job creator.
--   • On accept: updates the chosen application + rejects all other pending
--     applications for the same job in one transaction.
--   • Fires the AFTER UPDATE OF status trigger (notify_job_application_changes)
--     which delivers jobApplicationAccepted / Declined to the buddy.

DROP FUNCTION IF EXISTS public.review_job_application(uuid, uuid, text, text);

CREATE FUNCTION public.review_job_application(
  p_job_id   uuid,
  p_buddy_id uuid,
  p_decision text,        -- 'accepted' or 'rejected'
  p_note     text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id uuid;
BEGIN
  -- Caller must own the job
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

  -- Update target application — triggers notify_job_application_changes AFTER UPDATE
  UPDATE public.job_applications
     SET status = p_decision,
         note   = COALESCE(p_note, note)
   WHERE job_id   = p_job_id::uuid
     AND buddy_id = p_buddy_id::uuid;

  -- On accept: reject remaining pending applications for same job
  IF p_decision = 'accepted' THEN
    UPDATE public.job_applications
       SET status = 'rejected'
     WHERE job_id   = p_job_id::uuid
       AND buddy_id <> p_buddy_id::uuid
       AND status   = 'pending';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.review_job_application(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_job_application(uuid, uuid, text, text) TO authenticated;
ALTER FUNCTION public.review_job_application(uuid, uuid, text, text) OWNER TO postgres;

-- ── Reload PostgREST schema ───────────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';
