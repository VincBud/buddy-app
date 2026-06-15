-- Phase 1: Jobs table
-- Run in Supabase SQL Editor before enabling Supabase jobs persistence.
--
-- Design notes:
--   - `id` is text (keeps current Date.now() format; migrate to uuid in a later step)
--   - `payload` stores the full Job JSON so the app can reconstitute the full type without
--     additional joins. Top-level columns exist for efficient indexed queries.
--   - Phase 2 will promote payload fields (match, payment, etc.) to real columns and
--     remove the JSONB payload.

CREATE TABLE IF NOT EXISTS jobs (
  id           text PRIMARY KEY,
  creator_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'open',
  category     text NOT NULL,
  expires_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  payload      jsonb NOT NULL DEFAULT '{}'
);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS jobs_updated_at ON jobs;
CREATE TRIGGER jobs_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Indexes
CREATE INDEX IF NOT EXISTS jobs_creator_id_idx   ON jobs (creator_id);
CREATE INDEX IF NOT EXISTS jobs_status_idx      ON jobs (status);
CREATE INDEX IF NOT EXISTS jobs_expires_at_idx  ON jobs (expires_at);
CREATE INDEX IF NOT EXISTS jobs_created_at_idx  ON jobs (created_at DESC);

-- RLS
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

-- Public feed: anyone (authenticated) can read open, non-expired jobs
CREATE POLICY "jobs_read_open"
  ON jobs FOR SELECT
  USING (
    status = 'open'
    AND (expires_at IS NULL OR expires_at > now())
  );

-- Owner can read all their own jobs (any status)
CREATE POLICY "jobs_read_own"
  ON jobs FOR SELECT
  USING (creator_id = auth.uid());

-- Owner can insert their own jobs
CREATE POLICY "jobs_insert_own"
  ON jobs FOR INSERT
  WITH CHECK (creator_id = auth.uid());

-- Owner can update their own jobs
-- Phase 2: extend to allow matched buddy to update status fields
CREATE POLICY "jobs_update_own"
  ON jobs FOR UPDATE
  USING (creator_id = auth.uid());

-- Owner can delete their own open jobs
CREATE POLICY "jobs_delete_own"
  ON jobs FOR DELETE
  USING (creator_id = auth.uid() AND status = 'open');
