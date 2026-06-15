-- Notifications table — backend-driven notification storage.
-- RLS: each user can only read/update/delete their own rows.
-- INSERT is open to authenticated (client dual-writes optimistic notifications;
-- edge functions / triggers will write server-side in Phase 2).

CREATE TABLE IF NOT EXISTS public.notifications (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_id        uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  job_id          text,
  application_id  uuid,
  conversation_id uuid,
  type            text        NOT NULL,
  title           text        NOT NULL,
  body            text        NOT NULL DEFAULT '',
  payload         jsonb       NOT NULL DEFAULT '{}',
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_recipient_created_idx
  ON public.notifications (recipient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_job_id_idx
  ON public.notifications (job_id)
  WHERE job_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications_select_own"
  ON public.notifications FOR SELECT
  USING (recipient_id = auth.uid());

CREATE POLICY "notifications_insert_authenticated"
  ON public.notifications FOR INSERT
  WITH CHECK (true);

CREATE POLICY "notifications_update_own"
  ON public.notifications FOR UPDATE
  USING (recipient_id = auth.uid());

CREATE POLICY "notifications_delete_own"
  ON public.notifications FOR DELETE
  USING (recipient_id = auth.uid());
