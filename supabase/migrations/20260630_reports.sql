-- Support / Report System — Phase 1 backend foundation.
--
-- Implements the design in docs/support-report-system-plan.md:
--   - public.reports: one polymorphic table for all reportable entities
--     (job / user / message / completion / payment / general).
--   - RLS: reporters may read ONLY their own reports. There is no client write
--     path via the table — INSERT is not granted, so the only way to create a
--     report is the SECURITY DEFINER public.submit_report() RPC.
--   - submit_report(): derives reporter_id from auth.uid(), validates the
--     target + participant access, derives reported_user_id server-side, builds
--     evidence_snapshot server-side, rate-limits via the existing
--     public.check_rate_limit() helper, and de-duplicates open reports.
--
-- Conventions mirrored from existing migrations:
--   - jobs.id / messages.id / job_applications.id are uuid in the deployed DB.
--   - Participant checks use jobs.creator_id / jobs.assigned_buddy_id /
--     job_applications.status (never client payloads), as in
--     20260525_messages.sql and 20260525_reviews.sql.
--   - RAISE EXCEPTION '<code>' USING ERRCODE = 'P0001' for caller-facing errors,
--     as in 20260526_apply_to_job_rpc.sql.
--   - SECURITY DEFINER functions are owned by postgres (BYPASSRLS) so they can
--     read/write past RLS, and end with NOTIFY pgrst to refresh the API schema.
--
-- This migration does NOT touch the existing reportJobIssue dispute flow,
-- Persona code, or any existing RLS policy.

-- ── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.reports (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id       uuid        NOT NULL REFERENCES auth.users(id)     ON DELETE CASCADE,
  target_type       text        NOT NULL,
  reported_user_id  uuid        REFERENCES auth.users(id)              ON DELETE SET NULL,
  job_id            uuid        REFERENCES public.jobs(id)             ON DELETE SET NULL,
  message_id        uuid        REFERENCES public.messages(id)         ON DELETE SET NULL,
  reason            text        NOT NULL,
  note              text,
  evidence_snapshot jsonb,
  status            text        NOT NULL DEFAULT 'open',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- Allowed enumerations (kept as CHECKs rather than native enums so the set
  -- can be extended in a later migration without an ALTER TYPE dance).
  CONSTRAINT reports_target_type_valid CHECK (
    target_type IN ('job', 'user', 'message', 'completion', 'payment', 'general')
  ),
  CONSTRAINT reports_reason_valid CHECK (
    reason IN (
      'harassment', 'scam_fraud', 'inappropriate_content', 'no_show',
      'payment_issue', 'safety_concern', 'spam', 'other'
    )
  ),
  CONSTRAINT reports_status_valid CHECK (
    status IN ('open', 'reviewing', 'resolved', 'dismissed')
  ),

  -- Free-text note is length-capped.
  CONSTRAINT reports_note_len CHECK (note IS NULL OR char_length(note) <= 2000),

  -- A user can never be the reported party of their own report.
  CONSTRAINT reports_no_self_report CHECK (
    reported_user_id IS NULL OR reported_user_id <> reporter_id
  ),

  -- Required ids per target type.
  CONSTRAINT reports_target_shape CHECK (
    (target_type = 'message'                        AND message_id IS NOT NULL AND job_id IS NOT NULL)
    OR (target_type IN ('job', 'completion', 'payment') AND job_id IS NOT NULL)
    OR (target_type = 'user'                        AND reported_user_id IS NOT NULL)
    OR (target_type = 'general'                     AND job_id IS NULL
                                                    AND message_id IS NULL
                                                    AND reported_user_id IS NULL)
  )
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS reports_reporter_id_idx       ON public.reports (reporter_id);
CREATE INDEX IF NOT EXISTS reports_reported_user_id_idx  ON public.reports (reported_user_id);
CREATE INDEX IF NOT EXISTS reports_job_id_idx            ON public.reports (job_id);
CREATE INDEX IF NOT EXISTS reports_message_id_idx        ON public.reports (message_id);

-- Admin triage: newest open/active reports first.
CREATE INDEX IF NOT EXISTS reports_status_created_idx    ON public.reports (status, created_at DESC);

-- De-dupe: at most one OPEN report per (reporter, target_type, concrete target).
-- 'general' is excluded so a user can always file multiple support requests.
CREATE UNIQUE INDEX IF NOT EXISTS reports_open_dedupe_idx
  ON public.reports (reporter_id, target_type, COALESCE(message_id, job_id, reported_user_id))
  WHERE status = 'open' AND target_type <> 'general';

-- ── updated_at trigger ────────────────────────────────────────────────────────
-- Define the helper in public if missing. 20260506_jobs.sql created it without
-- a schema qualifier, so on some databases it is not resolvable as
-- public.set_updated_at(); recreate it idempotently here to be safe.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reports_updated_at ON public.reports;
CREATE TRIGGER reports_updated_at
  BEFORE UPDATE ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Grants ────────────────────────────────────────────────────────────────────

-- anon has no access whatsoever.
REVOKE ALL ON public.reports FROM anon;

-- authenticated may only READ their own reports (scoped by RLS below).
-- No INSERT/UPDATE/DELETE grant: the sole write path is submit_report().
REVOKE ALL ON public.reports FROM authenticated;
GRANT  SELECT ON public.reports TO authenticated;

-- service_role retains full access for admin/triage tooling.
GRANT ALL ON public.reports TO service_role;

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- SELECT: a reporter sees only their own reports. Reported users must never see
-- that a report exists about them, so there is deliberately no other read path.
DROP POLICY IF EXISTS "reports_select_own" ON public.reports;
CREATE POLICY "reports_select_own"
  ON public.reports FOR SELECT
  USING (public.reports.reporter_id = auth.uid());

-- No INSERT / UPDATE / DELETE policies: absence of policy + absence of grant
-- blocks every client-side write. submit_report() (owned by postgres, BYPASSRLS)
-- is the only writer; service_role bypasses RLS for status transitions.

-- ── Helper: is a user a participant of a job? ─────────────────────────────────
-- Mirrors the participant predicate used by messages/reviews RLS. SECURITY
-- DEFINER + owned by postgres so it can read jobs/job_applications past RLS.

CREATE OR REPLACE FUNCTION public.is_job_participant(p_job_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.jobs j
     WHERE j.id = p_job_id
       AND (j.creator_id = p_user_id OR j.assigned_buddy_id = p_user_id)
  )
  OR EXISTS (
    SELECT 1 FROM public.job_applications a
     WHERE a.job_id   = p_job_id
       AND a.buddy_id = p_user_id
       AND a.status   = 'accepted'
  );
$$;

-- Internal helper only: NOT granted to authenticated. submit_report() runs as
-- the postgres owner (BYPASSRLS) and can call it regardless of caller grants.
REVOKE ALL ON FUNCTION public.is_job_participant(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_job_participant(uuid, uuid) TO service_role;
ALTER FUNCTION public.is_job_participant(uuid, uuid) OWNER TO postgres;

-- ── RPC: submit_report() ──────────────────────────────────────────────────────
-- The only supported way to create a report.
--
-- Errors (all ERRCODE P0001): not_authenticated, invalid_target_type,
-- invalid_reason, note_too_long, rate_limit_exceeded, identity_verification_required,
-- job_id_required, job_not_found, message_not_found, reported_user_required,
-- not_a_participant, no_shared_context, cannot_report_self.
--
-- Returns: (report_id, status, created_at, deduplicated). When an identical open
-- report already exists, the existing row is returned with deduplicated = true.

CREATE OR REPLACE FUNCTION public.submit_report(
  p_target_type      text,
  p_reason           text,
  p_note             text DEFAULT NULL,
  p_job_id           uuid DEFAULT NULL,
  p_message_id       uuid DEFAULT NULL,
  p_reported_user_id uuid DEFAULT NULL
)
RETURNS TABLE (report_id uuid, status text, created_at timestamptz, deduplicated boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reporter    uuid := auth.uid();
  v_reported    uuid;
  v_job_id      uuid;
  v_evidence    jsonb;

  -- message context
  v_msg_job     uuid;
  v_msg_sender  uuid;
  v_msg_body    text;
  v_msg_image   text;
  v_msg_created timestamptz;

  -- job context
  v_job_title   text;
  v_job_status  text;
  v_creator     uuid;
  v_assigned    uuid;

  -- user context
  v_shared_job  uuid;

  -- dedupe / result
  v_existing    uuid;
  v_status      text;
  v_created     timestamptz;
BEGIN
  -- Caller must be authenticated.
  IF v_reporter IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  -- Validate enums up front (CHECK constraints are the backstop).
  IF p_target_type NOT IN ('job', 'user', 'message', 'completion', 'payment', 'general') THEN
    RAISE EXCEPTION 'invalid_target_type' USING ERRCODE = 'P0001';
  END IF;
  IF p_reason NOT IN (
    'harassment', 'scam_fraud', 'inappropriate_content', 'no_show',
    'payment_issue', 'safety_concern', 'spam', 'other'
  ) THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE = 'P0001';
  END IF;
  IF p_note IS NOT NULL AND char_length(p_note) > 2000 THEN
    RAISE EXCEPTION 'note_too_long' USING ERRCODE = 'P0001';
  END IF;

  -- Rate limit: 20 reports per hour per user (reuses M-1 limiter).
  IF NOT public.check_rate_limit(v_reporter, 'report_submit', 20, 3600) THEN
    RAISE EXCEPTION 'rate_limit_exceeded' USING ERRCODE = 'P0001';
  END IF;

  -- Identity verification is mandatory in Buddy; require it for every report
  -- that targets another user/job/message. 'general' support stays reachable so
  -- unverified or restricted users can still contact support.
  IF p_target_type <> 'general' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = v_reporter
         AND p.identity_verified_at IS NOT NULL
         AND p.verification_status  = 'approved'
    ) THEN
      RAISE EXCEPTION 'identity_verification_required' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- ── Per-target validation + server-side derivation ──────────────────────────
  IF p_target_type = 'message' THEN
    IF p_message_id IS NULL THEN
      RAISE EXCEPTION 'message_not_found' USING ERRCODE = 'P0001';
    END IF;

    SELECT m.job_id, m.sender_id, m.body, m.image_url, m.created_at
      INTO v_msg_job, v_msg_sender, v_msg_body, v_msg_image, v_msg_created
      FROM public.messages m
     WHERE m.id = p_message_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'message_not_found' USING ERRCODE = 'P0001';
    END IF;

    IF NOT public.is_job_participant(v_msg_job, v_reporter) THEN
      RAISE EXCEPTION 'not_a_participant' USING ERRCODE = 'P0001';
    END IF;

    v_job_id   := v_msg_job;            -- derived, never trusted from client
    v_reported := v_msg_sender;         -- the message author
    v_evidence := jsonb_build_object(
      'kind', 'message',
      'message_id', p_message_id,
      'job_id', v_msg_job,
      'sender_id', v_msg_sender,
      'body', v_msg_body,
      'has_image', (v_msg_image IS NOT NULL),
      'message_created_at', v_msg_created,
      'captured_at', now()
    );

  ELSIF p_target_type IN ('job', 'completion', 'payment') THEN
    IF p_job_id IS NULL THEN
      RAISE EXCEPTION 'job_id_required' USING ERRCODE = 'P0001';
    END IF;

    SELECT j.title, j.status, j.creator_id, j.assigned_buddy_id
      INTO v_job_title, v_job_status, v_creator, v_assigned
      FROM public.jobs j
     WHERE j.id = p_job_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'P0001';
    END IF;

    IF NOT public.is_job_participant(p_job_id, v_reporter) THEN
      RAISE EXCEPTION 'not_a_participant' USING ERRCODE = 'P0001';
    END IF;

    v_job_id := p_job_id;
    -- Derive the counterparty when it is unambiguous, else leave NULL (the
    -- report is about the job itself).
    IF v_creator = v_reporter THEN
      v_reported := v_assigned;
    ELSE
      v_reported := v_creator;
    END IF;

    v_evidence := jsonb_build_object(
      'kind', p_target_type,
      'job_id', p_job_id,
      'job_title', v_job_title,
      'job_status', v_job_status,
      'creator_id', v_creator,
      'assigned_buddy_id', v_assigned,
      'captured_at', now()
    );

  ELSIF p_target_type = 'user' THEN
    IF p_reported_user_id IS NULL THEN
      RAISE EXCEPTION 'reported_user_required' USING ERRCODE = 'P0001';
    END IF;
    v_reported := p_reported_user_id;

    -- Reporter and reported user must share a real job context: the reporter
    -- owns a job the other applied to / was assigned, or vice versa. Prevents
    -- reporting arbitrary strangers.
    SELECT j.id
      INTO v_shared_job
      FROM public.jobs j
     WHERE (
       (j.creator_id = v_reporter AND (
          j.assigned_buddy_id = v_reported
          OR EXISTS (SELECT 1 FROM public.job_applications a
                      WHERE a.job_id = j.id AND a.buddy_id = v_reported)
       ))
       OR
       (j.creator_id = v_reported AND (
          j.assigned_buddy_id = v_reporter
          OR EXISTS (SELECT 1 FROM public.job_applications a
                      WHERE a.job_id = j.id AND a.buddy_id = v_reporter)
       ))
     )
     LIMIT 1;
    IF v_shared_job IS NULL THEN
      RAISE EXCEPTION 'no_shared_context' USING ERRCODE = 'P0001';
    END IF;

    -- job_id intentionally left NULL on the row (shared job lives in evidence)
    -- so de-dupe is keyed on (reporter, reported_user).
    v_evidence := jsonb_build_object(
      'kind', 'user',
      'reported_user_id', v_reported,
      'shared_job_id', v_shared_job,
      'captured_at', now()
    );

  ELSE  -- 'general'
    v_evidence := jsonb_build_object('kind', 'general', 'captured_at', now());
  END IF;

  -- Self-report guard (defense in depth alongside the table CHECK).
  IF v_reported IS NOT NULL AND v_reported = v_reporter THEN
    RAISE EXCEPTION 'cannot_report_self' USING ERRCODE = 'P0001';
  END IF;

  -- ── De-dupe: return an existing open report on the same concrete target ──────
  IF p_target_type <> 'general' THEN
    SELECT r.id, r.status, r.created_at
      INTO v_existing, v_status, v_created
      FROM public.reports r
     WHERE r.reporter_id = v_reporter
       AND r.status      = 'open'
       AND r.target_type = p_target_type
       AND COALESCE(r.message_id, r.job_id, r.reported_user_id)
           IS NOT DISTINCT FROM COALESCE(p_message_id, v_job_id, v_reported)
     LIMIT 1;

    IF v_existing IS NOT NULL THEN
      report_id    := v_existing;
      status       := v_status;
      created_at   := v_created;
      deduplicated := true;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  -- ── Insert ──────────────────────────────────────────────────────────────────
  BEGIN
    INSERT INTO public.reports
      (reporter_id, target_type, reported_user_id, job_id, message_id,
       reason, note, evidence_snapshot)
    VALUES
      (v_reporter, p_target_type, v_reported, v_job_id, p_message_id,
       p_reason, p_note, v_evidence)
    RETURNING reports.id, reports.status, reports.created_at
      INTO v_existing, v_status, v_created;

    report_id    := v_existing;
    status       := v_status;
    created_at   := v_created;
    deduplicated := false;
    RETURN NEXT;

  EXCEPTION WHEN unique_violation THEN
    -- Lost a race against the partial unique index; return the winner.
    SELECT r.id, r.status, r.created_at
      INTO v_existing, v_status, v_created
      FROM public.reports r
     WHERE r.reporter_id = v_reporter
       AND r.status      = 'open'
       AND r.target_type = p_target_type
       AND COALESCE(r.message_id, r.job_id, r.reported_user_id)
           IS NOT DISTINCT FROM COALESCE(p_message_id, v_job_id, v_reported)
     LIMIT 1;

    report_id    := v_existing;
    status       := v_status;
    created_at   := v_created;
    deduplicated := true;
    RETURN NEXT;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_report(text, text, text, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_report(text, text, text, uuid, uuid, uuid) TO authenticated, service_role;

-- postgres has BYPASSRLS; SECURITY DEFINER as the postgres owner lets the
-- function INSERT into reports and read jobs/messages/job_applications past RLS.
ALTER FUNCTION public.submit_report(text, text, text, uuid, uuid, uuid) OWNER TO postgres;

-- ── Reload PostgREST schema so the new table + RPC are immediately callable ────

NOTIFY pgrst, 'reload schema';
