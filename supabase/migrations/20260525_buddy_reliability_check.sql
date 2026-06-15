-- Ensure buddy_reliability CHECK constraint exists on public.job_applications.
--
-- Background: the original 20260506_job_applications.sql defined an inline
-- (anonymous) CHECK on buddy_reliability. PostgreSQL auto-names inline
-- constraints as {table}_{column}_check, so the expected constraint name is
-- job_applications_buddy_reliability_check. In environments where the table
-- was created or altered outside of that migration the constraint may be absent.
--
-- This migration:
--   1. Raises an explicit error if any row contains an invalid value — it will
--      never silently coerce or delete data.
--   2. Adds the named CHECK constraint if it does not already exist, using
--      duplicate_object exception handling for full idempotency.
--   3. Does not touch RLS, GRANTs, triggers, or any other constraint.

-- ── Step 1: Fail loudly if invalid values exist ───────────────────────────────
-- Must run before ADD CONSTRAINT, which would itself fail on bad data but with
-- a less informative message. An explicit pre-flight gives the operator a clear
-- query to diagnose before any schema change is attempted.

DO $$
DECLARE
  v_bad_count integer;
BEGIN
  SELECT COUNT(*)
    INTO v_bad_count
    FROM public.job_applications
   WHERE public.job_applications.buddy_reliability IS NOT NULL
     AND public.job_applications.buddy_reliability NOT IN ('new', 'steady', 'trusted');

  IF v_bad_count > 0 THEN
    RAISE EXCEPTION
      E'buddy_reliability constraint cannot be added: % row(s) contain invalid values.\n'
      'Inspect them with:\n'
      '  SELECT id, buddy_reliability FROM public.job_applications\n'
      '  WHERE buddy_reliability IS NOT NULL\n'
      '    AND buddy_reliability NOT IN (''new'', ''steady'', ''trusted'');\n'
      'Fix or NULL-out the values, then re-run this migration.',
      v_bad_count;
  END IF;
END;
$$;

-- ── Step 2: Add constraint if it does not already exist ───────────────────────
-- duplicate_object (42710) is raised when a constraint with the same name
-- already exists — covers the case where the inline constraint from the
-- original migration is already present.

DO $$
BEGIN
  ALTER TABLE public.job_applications
    ADD CONSTRAINT job_applications_buddy_reliability_check
    CHECK (
      public.job_applications.buddy_reliability IN ('new', 'steady', 'trusted')
    );
EXCEPTION
  WHEN duplicate_object THEN
    NULL; -- constraint already present, nothing to do
END;
$$;
