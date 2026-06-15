-- Harden notifications INSERT policy.
--
-- Original "notifications_insert_authenticated" used WITH CHECK (true), allowing
-- any authenticated user to INSERT a notification with any recipient_id. This
-- enabled arbitrary cross-user notification injection (spoofing attack vector).
--
-- Fix: restrict INSERT to self-notifications only (recipient_id = auth.uid()).
--
-- Impact on cross-user flows:
--   The following client-side notification writes for OTHER users are now blocked
--   at the DB layer and will silently fall back to local-only delivery:
--
--     • Job owner accepts buddy application  → buddy's remote notification
--     • Job owner declines buddy application → buddy's remote notification
--     • Buddy applies for job               → job owner's remote notification
--
--   These flows still produce a local AsyncStorage notification for the acting user.
--   Remote delivery to the counterparty must be implemented server-side:
--     Option A: Postgres trigger on public.job_applications INSERT/UPDATE that
--               inserts into public.notifications using a SECURITY DEFINER function.
--     Option B: Supabase Edge Function invoked after the application upsert that
--               inserts the counterparty notification with the service-role client.
--
-- All other notification call sites already omit recipientId (local-only) and are
-- unaffected. SELECT, UPDATE, and DELETE policies are unchanged.

DROP POLICY IF EXISTS "notifications_insert_authenticated" ON public.notifications;

CREATE POLICY "notifications_insert_own"
  ON public.notifications FOR INSERT
  WITH CHECK (recipient_id = auth.uid());
