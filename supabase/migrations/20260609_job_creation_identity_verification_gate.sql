-- Phase 1.5: Job Creation Identity Verification Gate
--
-- Adds identity verification requirement to job creation.
-- Users must have identity_verified_at IS NOT NULL and verification_status = 'approved'
-- to insert jobs into public.jobs table.
--
-- Implementation:
--   1. Create helper function is_identity_verified(user_id)
--   2. Update jobs_insert_own RLS policy WITH CHECK to include verification check
--   3. Keep all existing behavior unchanged for verified users

-- ── Helper Function: is_identity_verified ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_identity_verified(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT true FROM public.profiles p
     WHERE p.id = p_user_id
       AND p.identity_verified_at IS NOT NULL
       AND p.verification_status = 'approved'),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.is_identity_verified(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_identity_verified(uuid) TO authenticated;

-- ── Update jobs_insert_own RLS Policy ──────────────────────────────────────
-- Now requires identity verification in addition to creator_id check

DROP POLICY IF EXISTS "jobs_insert_own" ON public.jobs;

CREATE POLICY "jobs_insert_own"
  ON jobs FOR INSERT
  WITH CHECK (
    creator_id = auth.uid()
    AND public.is_identity_verified(auth.uid())
  );

-- ── Reload PostgREST schema ────────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';
