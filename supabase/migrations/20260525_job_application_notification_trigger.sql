-- Server-side counterparty notifications for job application events.
--
-- Background: public.notifications INSERT is now restricted to
-- recipient_id = auth.uid() (see 20260525_notifications_rls_fix.sql).
-- Cross-user delivery must happen server-side.
--
-- This migration creates a SECURITY DEFINER trigger function that:
--   • Runs as its owner (postgres), bypassing RLS for the notification INSERT.
--   • Derives recipient_id from public.jobs / job_applications — never from
--     client-supplied payload — so the recipient cannot be spoofed.
--   • Fires on AFTER INSERT (buddy applied) and AFTER UPDATE OF status
--     (accepted / rejected) on public.job_applications.
--
-- Duplicate prevention: before each insert the function checks whether a
-- notification with the same (recipient_id, type, job_id) already exists and
-- skips if found. This handles retries and idempotent upserts from the client.
--
-- Notification events covered:
--   INSERT                → 'jobApplication'         → job owner
--   UPDATE status=accepted → 'jobApplicationAccepted' → buddy
--   UPDATE status=rejected → 'jobApplicationDeclined' → buddy

-- ── Trigger function ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notify_job_application_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
-- Lock search_path to prevent search-path injection via user-controlled schemas
SET search_path = public
AS $$
DECLARE
  v_job_title    text;
  v_job_owner    uuid;
  v_already_sent boolean;
BEGIN
  -- Pull job metadata from the authoritative jobs row.
  -- title and creator_id are never taken from client payload.
  SELECT j.title, j.creator_id
    INTO v_job_title, v_job_owner
    FROM public.jobs j
   WHERE j.id = NEW.job_id;

  -- Job may have been deleted in the same transaction; skip silently.
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
        'Neue Bewerbung',
        COALESCE(NEW.buddy_name, 'Ein Buddy')
          || ' hat sich für "'
          || COALESCE(v_job_title, 'deinen Auftrag')
          || '" beworben.',
        jsonb_build_object(
          'buddyName',  NEW.buddy_name,
          'buddyScore', NEW.buddy_score
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
          '{}'::jsonb
        );
      END IF;

    ELSIF NEW.status = 'rejected' THEN

      -- Guard against both type values in case of legacy data
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
          '{}'::jsonb
        );
      END IF;

    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Prevent direct invocation by unprivileged roles.
-- The function is called only by the trigger, never directly by clients.
REVOKE ALL ON FUNCTION public.notify_job_application_changes() FROM PUBLIC;

-- ── Triggers ──────────────────────────────────────────────────────────────────

-- AFTER INSERT: buddy applied
DROP TRIGGER IF EXISTS trg_notify_job_application_insert
  ON public.job_applications;

CREATE TRIGGER trg_notify_job_application_insert
  AFTER INSERT ON public.job_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_job_application_changes();

-- AFTER UPDATE OF status: accepted / rejected
DROP TRIGGER IF EXISTS trg_notify_job_application_status
  ON public.job_applications;

CREATE TRIGGER trg_notify_job_application_status
  AFTER UPDATE OF status ON public.job_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_job_application_changes();
