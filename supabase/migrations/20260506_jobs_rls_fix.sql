-- Jobs table RLS fix — safe to re-run in Supabase SQL Editor.
-- Drops and recreates all policies so partial-run states are corrected.
-- Run this if you see: "permission denied for table jobs"

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

-- Drop first to avoid "policy already exists" errors on re-run
DROP POLICY IF EXISTS "jobs_read_open"   ON jobs;
DROP POLICY IF EXISTS "jobs_read_own"    ON jobs;
DROP POLICY IF EXISTS "jobs_insert_own"  ON jobs;
DROP POLICY IF EXISTS "jobs_update_own"  ON jobs;
DROP POLICY IF EXISTS "jobs_delete_own"  ON jobs;

-- 1. Authenticated users can SELECT open, non-expired jobs (public feed)
CREATE POLICY "jobs_read_open"
  ON jobs FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND status = 'open'
    AND (expires_at IS NULL OR expires_at > now())
  );

-- 2. Job owners can SELECT all their own jobs regardless of status
CREATE POLICY "jobs_read_own"
  ON jobs FOR SELECT
  USING (creator_id = auth.uid());

-- 3. Authenticated users can INSERT jobs where they are the owner
CREATE POLICY "jobs_insert_own"
  ON jobs FOR INSERT
  WITH CHECK (creator_id = auth.uid());

-- 4. Job owners can UPDATE their own jobs
CREATE POLICY "jobs_update_own"
  ON jobs FOR UPDATE
  USING (creator_id = auth.uid())
  WITH CHECK (creator_id = auth.uid());

-- 5. Job owners can DELETE their own open jobs
CREATE POLICY "jobs_delete_own"
  ON jobs FOR DELETE
  USING (creator_id = auth.uid() AND status = 'open');
