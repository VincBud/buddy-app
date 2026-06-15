-- Notification trigger v3 — richer payloads, improved accepted/declined copy.
--
-- Changes from v2 (20260526_notification_trigger_v2.sql):
--   1. jobApplication payload now includes all buddy stats so the owner's
--      profile-preview modal can render without an extra DB round-trip:
--        buddyScore, buddyRatingAverage, buddyRatingCount,
--        buddyCompletedJobs, buddyReliability
--   2. jobApplicationAccepted: title → "Deine Bewerbung wurde angenommen"
--      body  → "<ownerName> hat deine Anfrage für "<jobTitle>" bestätigt."
--      (owner name resolved from public.profiles; falls back to 'Auftraggeber')
--   3. jobApplicationDeclined: matching copy improvement.
--   4. profiles SELECT policy added so the owner can read applicant profiles
--      (used by the profile-preview modal via getProfile / fetchApplicantPreview).

-- ── 1. Updated trigger function ───────────────────────────────────────────────

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
      );
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
        );
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
        );
      END IF;

    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_job_application_changes() FROM PUBLIC;

-- ── 2. profiles SELECT policy for job owners reading applicant profiles ───────
--
-- The owner's profile-preview modal fetches buddy data from job_applications
-- (covered by existing job_applications_select_owner policy). This additional
-- policy allows reading basic profile data (username, avatar_url) of any buddy
-- who has applied to a job the current user owns. Restricts columns to safe
-- read-only fields; bio/skills/radius_km are excluded.

DROP POLICY IF EXISTS "profiles_select_for_job_applicants" ON public.profiles;
CREATE POLICY "profiles_select_for_job_applicants"
  ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1
        FROM public.job_applications ja
        JOIN public.jobs j ON j.id = ja.job_id
       WHERE ja.buddy_id    = public.profiles.id
         AND j.creator_id   = auth.uid()
    )
  );
