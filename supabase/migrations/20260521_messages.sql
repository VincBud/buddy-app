-- Messages table for Buddy chat system.
--
-- Schema notes:
--   - public.jobs.id is 'uuid' in the actual Supabase database.
--     The local migration file 20260506_jobs.sql incorrectly declares it as
--     'text'; the deployed schema is authoritative.
--   - job_id is therefore uuid with an ON DELETE CASCADE FK to public.jobs(id).
--   - DROP + recreate is intentional: a prior partial run left an empty
--     messages table without job_id, causing 42703 errors on policy creation.
--   - No conversations table exists; job_id is the conversation key (1:1).
--   - System messages are local-only (client-generated); only user text/image
--     messages are stored here.

DROP TABLE IF EXISTS public.messages CASCADE;

CREATE TABLE public.messages (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id     uuid        NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  sender_id  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body       text,
  image_url  text,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz,
  metadata   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT messages_body_or_image CHECK (body IS NOT NULL OR image_url IS NOT NULL)
);

-- Primary query pattern: fetch all messages for a conversation in order
CREATE INDEX messages_job_created_idx
  ON public.messages (job_id, created_at ASC);

CREATE INDEX messages_sender_idx
  ON public.messages (sender_id);

-- Partial index for unread count queries — only indexes unread rows
CREATE INDEX messages_unread_idx
  ON public.messages (job_id, sender_id)
  WHERE read_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- SELECT: sender themselves OR job creator OR accepted buddy for that job
CREATE POLICY "messages_select_participants"
  ON public.messages FOR SELECT
  USING (
    public.messages.sender_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.jobs
       WHERE public.jobs.id = public.messages.job_id
         AND public.jobs.creator_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.job_applications
       WHERE public.job_applications.job_id = public.messages.job_id
         AND public.job_applications.buddy_id = auth.uid()
         AND public.job_applications.status = 'accepted'
    )
  );

-- INSERT: sender must be auth.uid() AND must be a participant in the job
-- Unqualified job_id/sender_id refer to the NEW row values in WITH CHECK
CREATE POLICY "messages_insert_participants"
  ON public.messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND (
      EXISTS (
        SELECT 1 FROM public.jobs
         WHERE public.jobs.id = job_id
           AND public.jobs.creator_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.job_applications
         WHERE public.job_applications.job_id = job_id
           AND public.job_applications.buddy_id = auth.uid()
           AND public.job_applications.status = 'accepted'
      )
    )
  );

-- UPDATE: any participant may stamp read_at on messages they received
CREATE POLICY "messages_update_participants"
  ON public.messages FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.jobs
       WHERE public.jobs.id = public.messages.job_id
         AND public.jobs.creator_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.job_applications
       WHERE public.job_applications.job_id = public.messages.job_id
         AND public.job_applications.buddy_id = auth.uid()
         AND public.job_applications.status = 'accepted'
    )
  );

-- DELETE: sender may delete their own messages only
CREATE POLICY "messages_delete_own"
  ON public.messages FOR DELETE
  USING (public.messages.sender_id = auth.uid());
