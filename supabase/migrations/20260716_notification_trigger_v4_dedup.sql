-- Notification trigger v4 — database-level dedup guarantee.
--
-- v3 (20260526_notification_trigger_v3.sql) deduplicates with SELECT EXISTS
-- checks. Those are not concurrency-safe: two racing transactions (double-tap
-- apply, RPC retry, both participants acting simultaneously) can both pass the
-- EXISTS check and insert the same business notification twice.
--
-- v4 adds:
--   1. A one-time cleanup of existing duplicate trigger notifications
--      (keeps the earliest row per business identity).
--   2. A UNIQUE partial index on the business identity
--      (recipient, type, job, actor) for the three trigger-written types.
--      Other types (message, jobExtended, …) legitimately repeat per job and
--      are NOT constrained.
--   3. The trigger inserts now use ON CONFLICT DO NOTHING so a racing duplicate
--      is silently dropped instead of raising a unique_violation that would
--      abort the surrounding business transaction (apply_to_job /
--      review_job_application run the trigger inside their own transaction).
--
-- Trigger copy/behaviour is otherwise identical to v3.

-- ── 1. One-time duplicate cleanup (keep the earliest row per identity) ─────────

DELETE FROM public.notifications n
 USING public.notifications keep
 WHERE n.type IN ('jobApplication', 'jobApplicationAccepted', 'jobApplicationDeclined')
   AND keep.type = n.type
   AND keep.recipient_id = n.recipient_id
   AND keep.job_id IS NOT DISTINCT FROM n.job_id
   AND COALESCE(keep.actor_id::text, '') = COALESCE(n.actor_id::text, '')
   AND (keep.created_at < n.created_at
        OR (keep.created_at = n.created_at AND keep.id < n.id));

-- ── 2. Unique business identity for trigger-written notifications ──────────────

CREATE UNIQUE INDEX IF NOT EXISTS notifications_trigger_identity_uidx
  ON public.notifications (recipient_id, type, job_id, COALESCE(actor_id::text, ''))
  WHERE type IN ('jobApplication', 'jobApplicationAccepted', 'jobApplicationDeclined');

-- ── 3. Trigger function v4 (v3 + ON CONFLICT DO NOTHING) ──────────────────────

CREATE OR REPLACE FUNCTION public.notify_job_application_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_title    text;
  v_job_owner    uuid;
  v_owner_name   text;
  v_already_sent boolean;
BEGIN
  SELECT j.title, j.creator_id
    INTO v_job_title, v_job_owner
    FROM public.jobs j
   WHERE j.id = NEW.job_id;

  IF NOT FOUND OR v_job_owner IS NULL THEN
    RETURN NEW;
  END IF;

  -- Resolve owner display name for buddy-facing notification copy
  SELECT COALESCE(p.username, 'Auftraggeber')
    INTO v_owner_name
    FROM public.profiles p
   WHERE p.id = v_job_owner;

  v_owner_name := COALESCE(v_owner_name, 'Auftraggeber');

  -- ── AFTER INSERT: buddy applied → notify job owner ────────────────────────
  IF TG_OP = 'INSERT' THEN

    SELECT EXISTS (
      SELECT 1 FROM public.notifications n
       WHERE n.recipient_id = v_job_owner
         AND n.type         = 'jobApplication'
         AND n.job_id::text = NEW.job_id::text
         AND n.actor_id     = NEW.buddy_id
    ) INTO v_already_sent;

    IF NOT v_already_sent THEN
      INSERT INTO public.notifications
        (recipient_id, actor_id, job_id, type, title, body, payload)
      VALUES (
        v_job_owner,
        NEW.buddy_id,
        NEW.job_id::text,
        'jobApplication',
        'Neue Bewerbung für "' || COALESCE(v_job_title, 'deinen Job') || '"',
        COALESCE(NEW.buddy_name, 'Ein Buddy')
          || ' hat sich auf deinen Job beworben.',
        jsonb_build_object(
          'buddyId',            NEW.buddy_id,
          'buddyName',          COALESCE(NEW.buddy_name, ''),
          'buddyScore',         NEW.buddy_score,
          'buddyRatingAverage', NEW.buddy_rating_average,
          'buddyRatingCount',   NEW.buddy_rating_count,
          'buddyCompletedJobs', NEW.buddy_completed_jobs,
          'buddyReliability',   NEW.buddy_reliability,
          'jobId',              NEW.job_id,
          'jobTitle',           COALESCE(v_job_title, '')
        )
      )
      ON CONFLICT DO NOTHING;
    END IF;

  -- ── AFTER UPDATE OF status ────────────────────────────────────────────────
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN

    IF NEW.status = 'accepted' THEN

      SELECT EXISTS (
        SELECT 1 FROM public.notifications n
         WHERE n.recipient_id = NEW.buddy_id
           AND n.type         = 'jobApplicationAccepted'
           AND n.job_id::text = NEW.job_id::text
      ) INTO v_already_sent;

      IF NOT v_already_sent THEN
        INSERT INTO public.notifications
          (recipient_id, actor_id, job_id, type, title, body, payload)
        VALUES (
          NEW.buddy_id,
          v_job_owner,
          NEW.job_id::text,
          'jobApplicationAccepted',
          'Deine Bewerbung wurde angenommen',
          v_owner_name
            || ' hat deine Anfrage für "'
            || COALESCE(v_job_title, 'einen Auftrag')
            || '" bestätigt.',
          jsonb_build_object(
            'jobId',    NEW.job_id,
            'jobTitle', COALESCE(v_job_title, '')
          )
        )
        ON CONFLICT DO NOTHING;
      END IF;

    ELSIF NEW.status = 'rejected' THEN

      SELECT EXISTS (
        SELECT 1 FROM public.notifications n
         WHERE n.recipient_id = NEW.buddy_id
           AND n.type         IN ('jobApplicationDeclined', 'jobApplicationRejected')
           AND n.job_id::text = NEW.job_id::text
      ) INTO v_already_sent;

      IF NOT v_already_sent THEN
        INSERT INTO public.notifications
          (recipient_id, actor_id, job_id, type, title, body, payload)
        VALUES (
          NEW.buddy_id,
          v_job_owner,
          NEW.job_id::text,
          'jobApplicationDeclined',
          'Deine Bewerbung wurde abgelehnt',
          'Leider hat sich '
            || v_owner_name
            || ' für eine andere Person entschieden.',
          jsonb_build_object(
            'jobId',    NEW.job_id,
            'jobTitle', COALESCE(v_job_title, '')
          )
        )
        ON CONFLICT DO NOTHING;
      END IF;

    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_job_application_changes() FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
