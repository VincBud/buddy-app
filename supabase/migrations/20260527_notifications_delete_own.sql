-- Allow authenticated users to delete their own notifications.
--
-- Required for: owner dismissing a stale "Neue Bewerbung" card after accepting
-- an application. The client calls deleteJobApplicationNotification(), which
-- issues a Supabase DELETE filtered by notification id. Without this policy
-- the DELETE is silently rejected by RLS and the card re-appears on next load.
--
-- Scope: recipient_id = auth.uid() — users can only delete their own rows.

DROP POLICY IF EXISTS "notifications_delete_own" ON public.notifications;

CREATE POLICY "notifications_delete_own"
  ON public.notifications FOR DELETE
  USING (recipient_id = auth.uid());

NOTIFY pgrst, 'reload schema';
