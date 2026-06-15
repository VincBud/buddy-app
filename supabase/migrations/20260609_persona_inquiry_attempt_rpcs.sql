-- Phase 3: Persona Inquiry Initiation RPCs
--
-- These functions support the create-persona-inquiry Edge Function. They are
-- intentionally service_role-only — clients can never call them directly,
-- only the trusted backend after it has verified auth.uid() via the JWT.
--
-- Flow:
--   1. Edge Function verifies the user's Supabase JWT and extracts p_user_id.
--   2. Edge Function calls preflight_identity_verification(p_user_id) → verdict.
--   3. Based on verdict:
--        already_verified      → return early, do not call Persona
--        retry_limit_reached   → return 429, do not call Persona
--        cooldown              → return 429 with remaining seconds
--        reuse_pending         → use existing_reference_id, skip Persona create
--        create_new            → POST to Persona, then call
--                                create_identity_verification_attempt(...)
--                                to record the new inquiry.
--
-- Authorization model:
--   - SECURITY DEFINER, owned by postgres (BYPASSRLS).
--   - EXECUTE granted ONLY to service_role.
--   - authenticated and anon explicitly revoked so the mobile client cannot
--     bypass the Edge Function and forge an inquiry under another user_id.

-- ── 1. Preflight: classify whether an inquiry can be started ────────────────

CREATE OR REPLACE FUNCTION public.preflight_identity_verification(
  p_user_id uuid
)
RETURNS TABLE (
  verdict                    text,
  retry_count                integer,
  existing_reference_id      text,
  cooldown_seconds_remaining integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile               public.profiles;
  v_pending               public.identity_verifications;
  v_retry_count           integer;
  v_last_attempt          timestamptz;
  v_cooldown_seconds      constant integer  := 30;
  v_retry_window          constant interval := interval '7 days';
  v_pending_reuse_window  constant interval := interval '24 hours';
  v_max_retries           constant integer  := 5;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'missing_user_id' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- Already verified → never start a new inquiry. Phase 1.5/2 gates rely on
  -- identity_verified_at staying populated.
  IF v_profile.identity_verified_at IS NOT NULL
     AND v_profile.verification_status = 'approved' THEN
    RETURN QUERY SELECT 'already_verified'::text, 0, NULL::text, 0;
    RETURN;
  END IF;

  -- Cooldown: short debounce so rapid taps don't spam Persona.
  v_last_attempt := v_profile.verification_last_attempt_at;
  IF v_last_attempt IS NOT NULL
     AND (now() - v_last_attempt) < make_interval(secs => v_cooldown_seconds) THEN
    RETURN QUERY SELECT
      'cooldown'::text,
      0,
      NULL::text,
      GREATEST(
        0,
        v_cooldown_seconds - EXTRACT(EPOCH FROM (now() - v_last_attempt))::integer
      );
    RETURN;
  END IF;

  -- Reuse the most recent pending inquiry within the reuse window so the user
  -- can continue an interrupted flow instead of stacking duplicates on Persona.
  SELECT * INTO v_pending
    FROM public.identity_verifications
   WHERE user_id = p_user_id
     AND status  = 'pending'
     AND submitted_at > now() - v_pending_reuse_window
   ORDER BY submitted_at DESC
   LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT
      'reuse_pending'::text,
      v_pending.retry_count,
      v_pending.provider_reference_id,
      0;
    RETURN;
  END IF;

  -- Retry limit: count terminal-failure attempts in the rolling window.
  SELECT COUNT(*)::integer INTO v_retry_count
    FROM public.identity_verifications
   WHERE user_id = p_user_id
     AND status IN ('rejected', 'expired')
     AND submitted_at > now() - v_retry_window;

  IF v_retry_count >= v_max_retries THEN
    RETURN QUERY SELECT 'retry_limit_reached'::text, v_retry_count, NULL::text, 0;
    RETURN;
  END IF;

  -- OK to create a fresh inquiry.
  RETURN QUERY SELECT 'create_new'::text, v_retry_count + 1, NULL::text, 0;
END;
$$;

ALTER FUNCTION public.preflight_identity_verification(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.preflight_identity_verification(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.preflight_identity_verification(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.preflight_identity_verification(uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.preflight_identity_verification(uuid) TO service_role;


-- ── 2. Record a newly created Persona inquiry ───────────────────────────────

CREATE OR REPLACE FUNCTION public.create_identity_verification_attempt(
  p_user_id               uuid,
  p_provider_reference_id text,
  p_retry_count           integer DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'missing_user_id' USING ERRCODE = 'P0001';
  END IF;

  IF p_provider_reference_id IS NULL OR length(p_provider_reference_id) = 0 THEN
    RAISE EXCEPTION 'missing_provider_reference_id' USING ERRCODE = 'P0001';
  END IF;

  -- Persist the attempt; the webhook will later flip status to a terminal
  -- value (approved / rejected / expired) when Persona reports back.
  INSERT INTO public.identity_verifications (
    user_id, provider, provider_reference_id, status, submitted_at, retry_count
  ) VALUES (
    p_user_id, 'persona', p_provider_reference_id, 'pending', now(),
    GREATEST(COALESCE(p_retry_count, 1), 1)
  )
  ON CONFLICT (user_id, provider_reference_id) DO UPDATE
    SET status = CASE
          -- Don't downgrade a terminal status if the webhook beat us here.
          WHEN public.identity_verifications.status IN ('approved', 'rejected', 'expired')
          THEN public.identity_verifications.status
          ELSE 'pending'
        END,
        updated_at = now();

  -- Stamp profile so the cooldown timer ticks and gates can read pending
  -- state. Never downgrade an already-approved user.
  UPDATE public.profiles
     SET verification_provider        = 'persona',
         verification_reference_id    = p_provider_reference_id,
         verification_last_attempt_at = now(),
         verification_status          = CASE
           WHEN verification_status = 'approved' THEN verification_status
           ELSE 'pending'
         END
   WHERE id = p_user_id;
END;
$$;

ALTER FUNCTION public.create_identity_verification_attempt(uuid, text, integer)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_identity_verification_attempt(uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_identity_verification_attempt(uuid, text, integer) FROM anon;
REVOKE ALL ON FUNCTION public.create_identity_verification_attempt(uuid, text, integer) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.create_identity_verification_attempt(uuid, text, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
