-- Fix: RLS INSERT policy "notifications_insert_own" (WITH CHECK recipient_id = auth.uid())
-- blocks the trigger when it inserts a notification for the job owner while
-- auth.uid() is the buddy (the calling user). SECURITY DEFINER does NOT bypass
-- RLS — it only changes the role for permission checks, not the JWT claims.
--
-- Making the function owned by the postgres role gives it BYPASSRLS so all
-- INSERTs inside the trigger execute without RLS interference.

ALTER FUNCTION public.notify_job_application_changes() OWNER TO postgres;
