-- Remove hard-delete capability from public.messages before launch.
--
-- Audit finding: messages_delete_own policy and DELETE grant exist, but no UI
-- surface calls DELETE on messages. Keeping them open pre-launch is unnecessary
-- attack surface — a compromised client could silently erase message history.
--
-- Decision: remove both the grant and the policy.
-- If soft-delete (deleted_at timestamptz) is needed later, add a column and an
-- UPDATE policy restricted to setting only that column; do not re-enable DELETE.

REVOKE DELETE ON public.messages FROM authenticated;

DROP POLICY IF EXISTS "messages_delete_own" ON public.messages;
