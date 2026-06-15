-- Server-side sanitization of buddy reputation fields on job_applications INSERT.
--
-- Audit finding: buddy_score, buddy_rating_average, buddy_rating_count,
-- buddy_completed_jobs, and buddy_reliability are all sourced from client-side
-- AsyncStorage (user.service.ts: getBuddyScore, getReliabilityStats). There is
-- no authoritative reputation system in the database yet. A buddy can set any
-- value in local storage and have it committed to the row.
--
-- Fix: BEFORE INSERT trigger that overwrites all five reputation fields with
-- NULL before the row is committed, regardless of what the client sent.
-- This is a placeholder strategy — when a real reputation system exists,
-- replace the NULL assignments with SELECTs from authoritative tables.
--
-- buddy_name is intentionally NOT sanitized here:
--   - It is display-only; buddy_id is the authoritative identity.
--   - Showing a wrong display name harms the buddy, not the system.
--   - Once profiles.username is the source of truth, derive it here instead.
--
-- Trigger order (alphabetical BEFORE INSERT on job_applications):
--   1. trg_guard_job_application_finalized  — rejects re-applies (existing)
--   2. trg_sanitize_job_application_reputation — nulls reputation fields (new)
--   AFTER INSERT:
--   3. trg_notify_job_application_insert    — sends notification (existing)
--      (notification payload will contain null buddy_score — acceptable)
--
-- No RLS or GRANT changes.

CREATE OR REPLACE FUNCTION public.sanitize_job_application_reputation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- ── Placeholder: no authoritative reputation tables exist yet ─────────────
  -- When real tables are available replace each NULL with a SELECT, e.g.:
  --   NEW.buddy_score := (
  --     SELECT score FROM public.buddy_scores WHERE user_id = NEW.buddy_id
  --   );
  NEW.buddy_score          := NULL;
  NEW.buddy_rating_average := NULL;
  NEW.buddy_rating_count   := NULL;
  NEW.buddy_completed_jobs := NULL;
  NEW.buddy_reliability    := NULL;

  -- buddy_name: keep client-supplied value for now.
  -- Future: NEW.buddy_name := (SELECT username FROM public.profiles WHERE id = NEW.buddy_id);

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sanitize_job_application_reputation() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_sanitize_job_application_reputation
  ON public.job_applications;

CREATE TRIGGER trg_sanitize_job_application_reputation
  BEFORE INSERT ON public.job_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.sanitize_job_application_reputation();
