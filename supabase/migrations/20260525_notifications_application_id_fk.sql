-- Add FK: public.notifications.application_id → public.job_applications(id)
--
-- Both columns are uuid in the deployed database.
-- application_id is never written by any current code path (always NULL).
--
-- Migration order:
--   1. Pre-flight: fail loudly if any non-null application_id has no matching
--      row in public.job_applications(id). Orphaned values would be rejected
--      by the FK anyway; surfacing them here gives a clear diagnostic.
--   2. Add named FK with ON DELETE SET NULL and duplicate_object guard.
--
-- RLS and GRANTs are unchanged.

-- ── Step 1: Pre-flight — halt on orphaned non-null values ─────────────────────

DO $$
DECLARE
  v_orphan_count integer;
BEGIN
  SELECT COUNT(*)
    INTO v_orphan_count
    FROM public.notifications n
   WHERE n.application_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.job_applications ja
        WHERE ja.id = n.application_id
     );

  IF v_orphan_count > 0 THEN
    RAISE EXCEPTION
      E'notifications.application_id FK migration blocked: % row(s) reference non-existent job_applications.\n'
      'Inspect with:\n'
      '  SELECT n.id, n.application_id FROM public.notifications n\n'
      '  WHERE n.application_id IS NOT NULL\n'
      '    AND NOT EXISTS (\n'
      '      SELECT 1 FROM public.job_applications ja WHERE ja.id = n.application_id\n'
      '    );\n'
      'NULL-out or correct the values, then re-run this migration.',
      v_orphan_count;
  END IF;
END;
$$;

-- ── Step 2: Add FK with idempotency guard ─────────────────────────────────────
-- ON DELETE SET NULL: deleting a job_application nulls the reference rather
-- than cascading, preserving the notification record for audit purposes.
-- duplicate_object (42710) is caught in case this migration is re-run.

DO $$
BEGIN
  ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_application_id_fkey
    FOREIGN KEY (application_id)
    REFERENCES public.job_applications (id)
    ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END;
$$;
