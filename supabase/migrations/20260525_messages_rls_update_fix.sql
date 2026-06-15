-- Fix messages UPDATE policy: restrict column access to read_at only.
--
-- Root cause: "messages_update_participants" used a bare USING clause with no
-- WITH CHECK and no column restriction. Any participant could UPDATE body,
-- image_url, sender_id, job_id, or metadata on any message in the conversation.
-- Intended purpose was mark-as-read only.
--
-- Fix uses two independent enforcement layers so neither alone is a SPOF:
--
--   Layer 1 — column-level privilege:
--     Revoke table-level UPDATE from authenticated; re-grant UPDATE(read_at) only.
--     PostgREST/Supabase enforces column privileges before RLS. Any client
--     attempt to update body/image_url/sender_id/job_id/metadata fails at the
--     privilege layer regardless of what the RLS policy would say.
--
--   Layer 2 — RLS policy:
--     Participants may only stamp read_at on messages sent by others (not their
--     own outgoing messages). The resulting row must have read_at IS NOT NULL
--     (prevents clearing read state via a null write).

-- ── Layer 1: column-level grant ───────────────────────────────────────────────

REVOKE UPDATE ON public.messages FROM authenticated;
GRANT  UPDATE (read_at) ON public.messages TO authenticated;

-- ── Layer 2: replace unsafe policy ───────────────────────────────────────────

DROP POLICY IF EXISTS "messages_update_participants" ON public.messages;

CREATE POLICY "messages_mark_read"
  ON public.messages FOR UPDATE
  USING (
    -- Caller must be a conversation participant (job creator or accepted buddy)
    (
      EXISTS (
        SELECT 1 FROM public.jobs
         WHERE public.jobs.id    = public.messages.job_id
           AND public.jobs.creator_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.job_applications
         WHERE public.job_applications.job_id   = public.messages.job_id
           AND public.job_applications.buddy_id = auth.uid()
           AND public.job_applications.status   = 'accepted'
      )
    )
    -- Can only touch messages sent by someone else — not own outgoing messages
    AND public.messages.sender_id != auth.uid()
  )
  WITH CHECK (
    -- read_at must be stamped to a real timestamp; null writes are rejected
    read_at IS NOT NULL
  );
