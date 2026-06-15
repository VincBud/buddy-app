-- Phase 1: Identity Verification Foundation
--
-- Adds minimal verification state to profiles and separate tables for
-- verification attempts and webhook audit logs.
--
-- Privacy model:
--   - profiles: only verification_status, provider, timestamps (no sensitive docs)
--   - identity_verifications: user's verification attempt history
--   - identity_verification_webhooks: server-side webhook audit log (users can't access)

-- ── Update public.profiles (minimal verification state) ───────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS identity_verified_at       timestamptz,
  ADD COLUMN IF NOT EXISTS verification_status        text DEFAULT 'not_started' CHECK (
    verification_status IN ('not_started', 'pending', 'approved', 'rejected', 'manual_review', 'expired')
  ),
  ADD COLUMN IF NOT EXISTS verification_provider      text DEFAULT 'persona',
  ADD COLUMN IF NOT EXISTS verification_reference_id  text,
  ADD COLUMN IF NOT EXISTS verification_last_attempt_at timestamptz;

-- ── Identity Verification Attempts Table ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.identity_verifications (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider              text NOT NULL DEFAULT 'persona' CHECK (provider = 'persona'),
  provider_reference_id text NOT NULL,  -- e.g., Persona inquiry ID
  status                text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'approved', 'rejected', 'manual_review', 'expired')
  ),
  submitted_at          timestamptz NOT NULL DEFAULT now(),
  completed_at          timestamptz,
  rejection_reason      text,  -- e.g., 'document_unclear', 'liveness_failed'
  retry_count           integer NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, provider_reference_id)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS identity_verifications_user_id_idx
  ON public.identity_verifications(user_id);

CREATE INDEX IF NOT EXISTS identity_verifications_status_idx
  ON public.identity_verifications(status);

CREATE INDEX IF NOT EXISTS identity_verifications_provider_reference_id_idx
  ON public.identity_verifications(provider_reference_id);

CREATE INDEX IF NOT EXISTS identity_verifications_submitted_at_idx
  ON public.identity_verifications(submitted_at);

-- ── Identity Verification Webhooks Table ──────────────────────────────────────
-- Server-side only; users cannot read or write

CREATE TABLE IF NOT EXISTS public.identity_verification_webhooks (
  id                    bigserial PRIMARY KEY,
  webhook_id            text NOT NULL UNIQUE,  -- Provider's webhook ID for idempotency
  provider              text NOT NULL,  -- 'persona'
  event_type            text NOT NULL,  -- 'inquiry.completed', etc.
  user_id               uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_reference_id text,  -- e.g., Persona inquiry ID
  payload               jsonb NOT NULL,  -- Raw webhook payload
  processed             boolean NOT NULL DEFAULT false,
  processed_at          timestamptz,
  error_message         text,
  received_at           timestamptz NOT NULL DEFAULT now()
);

-- Indexes for efficient webhook processing and debugging
CREATE INDEX IF NOT EXISTS identity_verification_webhooks_provider_idx
  ON public.identity_verification_webhooks(provider);

CREATE INDEX IF NOT EXISTS identity_verification_webhooks_processed_idx
  ON public.identity_verification_webhooks(processed);

CREATE INDEX IF NOT EXISTS identity_verification_webhooks_user_id_idx
  ON public.identity_verification_webhooks(user_id);

CREATE INDEX IF NOT EXISTS identity_verification_webhooks_received_at_idx
  ON public.identity_verification_webhooks(received_at);

-- ── RLS: public.identity_verifications ───────────────────────────────────────

ALTER TABLE public.identity_verifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "identity_verifications_select_own" ON public.identity_verifications;
CREATE POLICY "identity_verifications_select_own"
  ON public.identity_verifications FOR SELECT
  USING (user_id = auth.uid());

-- Users cannot insert/update/delete verification records directly;
-- only server-side RPC/webhook processing creates these rows.
-- (No INSERT/UPDATE/DELETE policies — full denial by default)

-- ── RLS: public.identity_verification_webhooks ───────────────────────────────
-- Service-role only; normal authenticated users have zero access

ALTER TABLE public.identity_verification_webhooks ENABLE ROW LEVEL SECURITY;

-- No SELECT/INSERT/UPDATE/DELETE policies for authenticated users
-- (Full denial by default; service_role can read via direct connection)

-- ── GRANT Statements ──────────────────────────────────────────────────────────

-- identity_verifications: authenticated users can only SELECT their own rows (RLS enforced)
GRANT SELECT ON public.identity_verifications TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.identity_verifications FROM authenticated;

-- identity_verification_webhooks: no access for authenticated users
REVOKE ALL ON public.identity_verification_webhooks FROM authenticated;

-- ── Helper RPC: get_my_verification_status() ──────────────────────────────────
-- Returns the authenticated user's current verification state from profiles table

CREATE OR REPLACE FUNCTION public.get_my_verification_status()
RETURNS TABLE (
  identity_verified_at      timestamptz,
  verification_status       text,
  verification_provider     text,
  verification_last_attempt_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    p.identity_verified_at,
    p.verification_status,
    p.verification_provider,
    p.verification_last_attempt_at
  FROM public.profiles p
  WHERE p.id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_verification_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_verification_status() TO authenticated;

-- ── Reload PostgREST schema ────────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';
