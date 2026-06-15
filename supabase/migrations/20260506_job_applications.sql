-- Phase 1: Job applications table
-- Stores buddy applications per job as a proper relational entity.
-- Applications are also embedded in jobs.payload for backwards compatibility with
-- the dual-write merge; this table is the authoritative source for queries.
--
-- Requires: 20260506_jobs.sql (set_updated_at function must exist)

CREATE TABLE IF NOT EXISTS job_applications (
  id                   text PRIMARY KEY,
  job_id               text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  buddy_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  buddy_name           text NOT NULL DEFAULT '',
  buddy_score          numeric,
  buddy_rating_average numeric,
  buddy_rating_count   integer,
  buddy_completed_jobs integer,
  buddy_reliability    text CHECK (buddy_reliability IN ('new', 'steady', 'trusted')),
  status               text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  note                 text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id, buddy_id)
);

-- updated_at trigger (reuses set_updated_at from jobs migration)
DROP TRIGGER IF EXISTS job_applications_updated_at ON job_applications;
CREATE TRIGGER job_applications_updated_at
  BEFORE UPDATE ON job_applications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Indexes
CREATE INDEX IF NOT EXISTS job_applications_job_id_idx   ON job_applications (job_id);
CREATE INDEX IF NOT EXISTS job_applications_buddy_id_idx ON job_applications (buddy_id);
CREATE INDEX IF NOT EXISTS job_applications_status_idx   ON job_applications (status);

-- RLS
ALTER TABLE job_applications ENABLE ROW LEVEL SECURITY;

-- Buddy can apply (insert own row)
CREATE POLICY "job_applications_insert_own"
  ON job_applications FOR INSERT
  WITH CHECK (buddy_id = auth.uid());

-- Buddy can read their own applications
CREATE POLICY "job_applications_select_buddy"
  ON job_applications FOR SELECT
  USING (buddy_id = auth.uid());

-- Job owner can read all applications for their jobs
CREATE POLICY "job_applications_select_owner"
  ON job_applications FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM jobs
      WHERE jobs.id = job_applications.job_id
        AND jobs.creator_id = auth.uid()
    )
  );

-- Job owner can update application status (accept / reject)
CREATE POLICY "job_applications_update_owner"
  ON job_applications FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM jobs
      WHERE jobs.id = job_applications.job_id
        AND jobs.creator_id = auth.uid()
    )
  );
