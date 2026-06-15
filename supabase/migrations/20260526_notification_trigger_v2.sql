-- Improve jobApplication notification: richer title and payload.
--
-- Changes from v1 (20260525_job_application_notification_trigger.sql):
--   1. title: "Neue Bewerbung" → "Neue Bewerbung für "{jobTitle}""
--      so the owner immediately sees which job received the application.
--   2. payload: adds buddyId, buddyName, jobId, jobTitle so the client can
--      act on the notification without querying local job state:
--        - buddyId  → used by reviewApplication() instead of local lookup
--        - buddyName → shown in the card body fallback
--        - jobId    → equals job_id column, convenient for JS consumers
--        - jobTitle → title of the job for display

CREATE OR REPLACE FUNCTION public.notify_job_application_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_title    text;
  v_job_owner    uuid;
  v_already_sent boolean;
BEGIN
  SELECT j.title, j.creator_id
    INTO v_job_title, v_job_owner
    FROM public.jobs j
   WHERE j.id = NEW.job_id;

  IF NOT FOUND OR v_job_owner IS NULL THEN
    RETURN NEW;
  END IF;

  -- ── AFTER INSERT: buddy applied → notify job owner ────────────────────────
  IF TG_OP = 'INSERT' THEN

    SELECT EXISTS (
      SELECT 1 FROM public.notifications n
       WHERE n.recipient_id = v_job_owner
         AND n.type         = 'jobApplication'
         AND n.job_id       = NEW.job_id
         AND n.actor_id     = NEW.buddy_id
    ) INTO v_already_sent;

    IF NOT v_already_sent THEN
      INSERT INTO public.notifications
        (recipient_id, actor_id, job_id, type, title, body, payload)
      VALUES (
        v_job_owner,
        NEW.buddy_id,
        NEW.job_id,
        'jobApplication',
        'Neue Bewerbung für "' || COALESCE(v_job_title, 'deinen Job') || '"',
        COALESCE(NEW.buddy_name, 'Ein Buddy')
          || ' hat sich auf deinen Job beworben.',
        jsonb_build_object(
          'buddyId',   NEW.buddy_id,
          'buddyName', COALESCE(NEW.buddy_name, ''),
          'jobId',     NEW.job_id,
          'jobTitle',  COALESCE(v_job_title, '')
        )
      );
    END IF;

  -- ── AFTER UPDATE OF status ────────────────────────────────────────────────
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN

    IF NEW.status = 'accepted' THEN

      SELECT EXISTS (
        SELECT 1 FROM public.notifications n
         WHERE n.recipient_id = NEW.buddy_id
           AND n.type         = 'jobApplicationAccepted'
           AND n.job_id       = NEW.job_id
      ) INTO v_already_sent;

      IF NOT v_already_sent THEN
        INSERT INTO public.notifications
          (recipient_id, actor_id, job_id, type, title, body, payload)
        VALUES (
          NEW.buddy_id,
          v_job_owner,
          NEW.job_id,
          'jobApplicationAccepted',
          'Bewerbung angenommen',
          'Du wurdest für "'
            || COALESCE(v_job_title, 'einen Auftrag')
            || '" ausgewählt.',
          jsonb_build_object(
            'jobId',    NEW.job_id,
            'jobTitle', COALESCE(v_job_title, '')
          )
        );
      END IF;

    ELSIF NEW.status = 'rejected' THEN

      SELECT EXISTS (
        SELECT 1 FROM public.notifications n
         WHERE n.recipient_id = NEW.buddy_id
           AND n.type         IN ('jobApplicationDeclined', 'jobApplicationRejected')
           AND n.job_id       = NEW.job_id
      ) INTO v_already_sent;

      IF NOT v_already_sent THEN
        INSERT INTO public.notifications
          (recipient_id, actor_id, job_id, type, title, body, payload)
        VALUES (
          NEW.buddy_id,
          v_job_owner,
          NEW.job_id,
          'jobApplicationDeclined',
          'Bewerbung abgelehnt',
          'Deine Bewerbung für "'
            || COALESCE(v_job_title, 'einen Auftrag')
            || '" wurde abgelehnt.',
          jsonb_build_object(
            'jobId',    NEW.job_id,
            'jobTitle', COALESCE(v_job_title, '')
          )
        );
      END IF;

    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_job_application_changes() FROM PUBLIC;

-- Triggers are already attached from v1 — no need to recreate them.
-- DROP + CREATE only if the function signature changes (it hasn't).
