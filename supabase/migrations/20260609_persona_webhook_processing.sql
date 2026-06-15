-- Phase 2: Persona Webhook Processing RPC
--
-- Provides a transactional way for the persona-webhook Edge Function to
-- apply identity-verification state changes after it has safely stored the
-- raw webhook event in public.identity_verification_webhooks.
--
-- Flow expected from the Edge Function (running as service_role):
--   1. Verify Persona HMAC signature on the raw request body.
--   2. UPSERT the raw event into public.identity_verification_webhooks
--      (UNIQUE(webhook_id) makes storage idempotent).
--   3. If the webhook is not yet processed, call public.process_persona_webhook(...)
--      to upsert into public.identity_verifications and patch public.profiles.
--   4. Mark the webhook row as processed = true on success, or stamp
--      error_message on failure (handled in the Edge Function).
--
-- Authorization model:
--   - SECURITY DEFINER, owned by postgres (BYPASSRLS), so this can write to
--     profiles / identity_verifications regardless of any RLS policies.
--   - EXECUTE granted ONLY to service_role. authenticated/anon are explicitly
--     revoked so app users cannot mutate verification state from the client.
--   - The function never trusts client input directly; the Edge Function
--     resolves user_id from Persona-side metadata (reference-id / fields).

CREATE OR REPLACE FUNCTION public.process_persona_webhook(
  p_webhook_id            text,
  p_user_id               uuid,
  p_event_type            text,
  p_provider_reference_id text,
  p_persona_status        text,
  p_rejection_reason      text DEFAULT NULL,
  p_completed             boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mapped_status text;
  v_is_terminal   boolean;
  v_completed_at  timestamptz;
BEGIN
  IF p_provider_reference_id IS NULL OR length(p_provider_reference_id) = 0 THEN
    RAISE EXCEPTION 'missing_provider_reference_id' USING ERRCODE = 'P0001';
  END IF;

  -- Map Persona inquiry status → Buddy verification_status enum.
  -- Persona statuses observed in practice: created, pending, started,
  -- in_progress, completed, approved, declined, failed, expired,
  -- needs_review / marked-for-review.
  v_mapped_status := CASE LOWER(COALESCE(p_persona_status, ''))
    WHEN 'completed'         THEN 'approved'
    WHEN 'approved'          THEN 'approved'
    WHEN 'failed'            THEN 'rejected'
    WHEN 'declined'          THEN 'rejected'
    WHEN 'expired'           THEN 'expired'
    WHEN 'needs_review'      THEN 'manual_review'
    WHEN 'needs-review'      THEN 'manual_review'
    WHEN 'marked-for-review' THEN 'manual_review'
    WHEN 'manual_review'     THEN 'manual_review'
    WHEN 'pending'           THEN 'pending'
    WHEN 'created'           THEN 'pending'
    WHEN 'started'           THEN 'pending'
    WHEN 'in_progress'       THEN 'pending'
    ELSE                          'pending'
  END;

  v_is_terminal  := v_mapped_status IN ('approved', 'rejected', 'expired');
  v_completed_at := CASE
    WHEN v_is_terminal OR p_completed THEN now()
    ELSE NULL
  END;

  -- If we cannot resolve the Buddy user, the Edge Function has already
  -- persisted the raw payload for later reconciliation. Nothing more to do.
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  -- Upsert verification attempt history (unique on user_id + reference_id).
  INSERT INTO public.identity_verifications (
    user_id,
    provider,
    provider_reference_id,
    status,
    submitted_at,
    completed_at,
    rejection_reason,
    retry_count
  ) VALUES (
    p_user_id,
    'persona',
    p_provider_reference_id,
    v_mapped_status,
    now(),
    v_completed_at,
    p_rejection_reason,
    1
  )
  ON CONFLICT (user_id, provider_reference_id) DO UPDATE
    SET status           = EXCLUDED.status,
        completed_at     = COALESCE(EXCLUDED.completed_at, public.identity_verifications.completed_at),
        rejection_reason = COALESCE(EXCLUDED.rejection_reason, public.identity_verifications.rejection_reason),
        updated_at       = now();

  -- Patch the user's profile so RLS gates and client UI reflect new state.
  -- identity_verified_at is set once on first approval and cleared if the
  -- verification later transitions to rejected/expired.
  UPDATE public.profiles
     SET verification_status          = v_mapped_status,
         verification_provider        = 'persona',
         verification_reference_id    = p_provider_reference_id,
         verification_last_attempt_at = now(),
         identity_verified_at         = CASE
           WHEN v_mapped_status = 'approved'
             THEN COALESCE(identity_verified_at, now())
           WHEN v_mapped_status IN ('rejected', 'expired')
             THEN NULL
           ELSE identity_verified_at
         END
   WHERE id = p_user_id;
END;
$$;

ALTER FUNCTION public.process_persona_webhook(text, uuid, text, text, text, text, boolean)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.process_persona_webhook(text, uuid, text, text, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_persona_webhook(text, uuid, text, text, text, text, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.process_persona_webhook(text, uuid, text, text, text, text, boolean) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.process_persona_webhook(text, uuid, text, text, text, text, boolean) TO service_role;

NOTIFY pgrst, 'reload schema';
