-- Fix type mismatch: job_applications.job_id (text) vs jobs.id (uuid).
--
-- Root cause: the original migration declared job_applications.id and job_id
-- as text, but the deployed jobs table has id as uuid. Every RLS policy and
-- trigger that joins jobs.id = job_applications.job_id fails with:
--   "operator does not exist: text = uuid" (code 42883)
--
-- This includes:
--   • job_applications_select_owner  — SELECT policy
--   • job_applications_update_owner  — UPDATE policy + WITH CHECK
--   • notify_job_application_changes — AFTER INSERT trigger (job owner notification)
--
-- Fix: convert job_applications.id and job_id to uuid.
-- The deployed DB already has job_applications.id as uuid (confirmed);
-- the conditional block below is a no-op in that case.
-- job_id is still text and must be converted.
--
-- Safety gate: abort if any existing job_id cannot be cast to uuid.

-- ── Step 1: preflight ─────────────────────────────────────────────────────────

DO $$
DECLARE
  v_bad_id    integer;
  v_bad_job_id integer;
BEGIN
  -- Check id column (may already be uuid — skip gracefully)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'job_applications'
       AND column_name  = 'id'
       AND data_type    = 'text'
  ) THEN
    SELECT COUNT(*) INTO v_bad_id
      FROM public.job_applications
     WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
    IF v_bad_id > 0 THEN
      RAISE EXCEPTION 'Cannot convert id: % rows have non-UUID values', v_bad_id;
    END IF;
  END IF;

  SELECT COUNT(*) INTO v_bad_job_id
    FROM public.job_applications
   WHERE job_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  IF v_bad_job_id > 0 THEN
    RAISE EXCEPTION 'Cannot convert job_id: % rows have non-UUID values', v_bad_job_id;
  END IF;
END;
$$;

-- ── Step 2: convert id (only if still text) ───────────────────────────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'job_applications'
       AND column_name  = 'id'
       AND data_type    = 'text'
  ) THEN
    ALTER TABLE public.job_applications
      ALTER COLUMN id TYPE uuid USING id::uuid;

    ALTER TABLE public.job_applications
      ALTER COLUMN id SET DEFAULT gen_random_uuid();
  END IF;
END;
$$;

-- ── Step 3: convert job_id text → uuid ───────────────────────────────────────

-- Drop FK first (cannot alter a column that is part of a FK in-place)
ALTER TABLE public.job_applications
  DROP CONSTRAINT IF EXISTS job_applications_job_id_fkey;

-- Also drop the old text-based UNIQUE constraint so we can recreate it on uuid
ALTER TABLE public.job_applications
  DROP CONSTRAINT IF EXISTS job_applications_job_id_buddy_id_key;

ALTER TABLE public.job_applications
  ALTER COLUMN job_id TYPE uuid USING job_id::uuid;

-- Recreate FK to public.jobs(id)
ALTER TABLE public.job_applications
  ADD CONSTRAINT job_applications_job_id_fkey
  FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;

-- Recreate UNIQUE constraint
ALTER TABLE public.job_applications
  ADD CONSTRAINT job_applications_job_id_buddy_id_key
  UNIQUE (job_id, buddy_id);

-- ── Step 4: recreate broken RLS policies ─────────────────────────────────────
-- All three policies compare jobs.id (uuid) = job_applications.job_id.
-- After the column conversion these are uuid = uuid — no cast needed.
-- Drop and recreate to flush any cached plan.

DROP POLICY IF EXISTS "job_applications_select_owner" ON public.job_applications;
CREATE POLICY "job_applications_select_owner"
  ON public.job_applications FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.jobs
       WHERE public.jobs.id         = public.job_applications.job_id
         AND public.jobs.creator_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "job_applications_update_owner" ON public.job_applications;
CREATE POLICY "job_applications_update_owner"
  ON public.job_applications FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.jobs
       WHERE public.jobs.id         = public.job_applications.job_id
         AND public.jobs.creator_id = auth.uid()
    )
  )
  WITH CHECK (
    public.job_applications.status IN ('pending', 'accepted', 'rejected')
    AND EXISTS (
      SELECT 1 FROM public.job_applications existing
       WHERE existing.id         = public.job_applications.id
         AND existing.job_id     = public.job_applications.job_id
         AND existing.buddy_id   = public.job_applications.buddy_id
         AND existing.created_at = public.job_applications.created_at
    )
    AND NOT (
      public.job_applications.status = 'pending'
      AND (
        SELECT existing.status
          FROM public.job_applications existing
         WHERE existing.id = public.job_applications.id
      ) IN ('accepted', 'rejected')
    )
  );

-- ── Step 5: grants + RLS (idempotent) ────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_applications TO authenticated;
ALTER TABLE public.job_applications ENABLE ROW LEVEL SECURITY;
