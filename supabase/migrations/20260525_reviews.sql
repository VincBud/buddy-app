-- Post-job reviews (ratings) from one job participant to the other.
--
-- Participant verification uses public.job_applications (accepted buddy) and
-- public.jobs.creator_id (owner) — not the JSONB payload — so it cannot be
-- spoofed by a crafted client payload.
--
-- Aggregation: get_reviewee_rating_stats(uuid) is a SECURITY DEFINER function
-- that bypasses per-row RLS to produce public rating averages without exposing
-- individual review content to non-participants.

-- ── Schema ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.reviews (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      uuid        NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  reviewer_id uuid        NOT NULL REFERENCES auth.users(id)  ON DELETE CASCADE,
  reviewee_id uuid        NOT NULL REFERENCES auth.users(id)  ON DELETE CASCADE,
  rating      integer     NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reviews_no_self_review CHECK (reviewer_id != reviewee_id),
  CONSTRAINT reviews_unique_pair    UNIQUE (job_id, reviewer_id, reviewee_id)
);

CREATE INDEX IF NOT EXISTS reviews_reviewee_created_idx
  ON public.reviews (reviewee_id, created_at DESC);

CREATE INDEX IF NOT EXISTS reviews_job_id_idx
  ON public.reviews (job_id);

-- ── GRANTs ────────────────────────────────────────────────────────────────────

REVOKE ALL ON public.reviews FROM anon;
GRANT SELECT, INSERT ON public.reviews TO authenticated;
-- No UPDATE / DELETE grants — reviews are immutable once written.

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

-- SELECT: only the reviewer or reviewee may read individual reviews.
-- Aggregate stats are exposed via get_reviewee_rating_stats() instead.
DROP POLICY IF EXISTS "reviews_select_participant" ON public.reviews;
CREATE POLICY "reviews_select_participant"
  ON public.reviews FOR SELECT
  USING (
    public.reviews.reviewer_id = auth.uid()
    OR public.reviews.reviewee_id = auth.uid()
  );

-- INSERT: secure participant + completion check.
-- Two valid cases:
--   A) Caller is the job owner (creator_id = auth.uid())
--      and reviewee is the accepted buddy for that job.
--   B) Caller is the accepted buddy
--      and reviewee is the job owner (creator_id).
-- Both cases also require job.status = 'completed'.
DROP POLICY IF EXISTS "reviews_insert_participant" ON public.reviews;
CREATE POLICY "reviews_insert_participant"
  ON public.reviews FOR INSERT
  WITH CHECK (
    -- Reviewer must be the authenticated user — never spoofable
    public.reviews.reviewer_id = auth.uid()

    -- Job must be in terminal completed state
    AND EXISTS (
      SELECT 1 FROM public.jobs
       WHERE public.jobs.id     = public.reviews.job_id
         AND public.jobs.status = 'completed'
    )

    -- Caller is the owner reviewing the buddy they accepted
    AND (
      (
        EXISTS (
          SELECT 1 FROM public.jobs
           WHERE public.jobs.id         = public.reviews.job_id
             AND public.jobs.creator_id = auth.uid()
        )
        AND EXISTS (
          SELECT 1 FROM public.job_applications
           WHERE public.job_applications.job_id   = public.reviews.job_id
             AND public.job_applications.buddy_id = public.reviews.reviewee_id
             AND public.job_applications.status   = 'accepted'
        )
      )
      OR
      -- Caller is the accepted buddy reviewing the job owner
      (
        EXISTS (
          SELECT 1 FROM public.job_applications
           WHERE public.job_applications.job_id   = public.reviews.job_id
             AND public.job_applications.buddy_id = auth.uid()
             AND public.job_applications.status   = 'accepted'
        )
        AND EXISTS (
          SELECT 1 FROM public.jobs
           WHERE public.jobs.id         = public.reviews.job_id
             AND public.jobs.creator_id = public.reviews.reviewee_id
        )
      )
    )
  );

-- No UPDATE or DELETE policies — absence of policy blocks those operations.

-- ── Aggregate RPC ─────────────────────────────────────────────────────────────
-- Returns rating_average and rating_count for any user.
-- SECURITY DEFINER bypasses per-row RLS so any authenticated caller can
-- query public reputation stats without seeing individual review content.

CREATE OR REPLACE FUNCTION public.get_reviewee_rating_stats(p_reviewee_id uuid)
RETURNS TABLE (rating_average numeric, rating_count integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ROUND(AVG(rating)::numeric, 2) AS rating_average,
    COUNT(*)::integer               AS rating_count
  FROM public.reviews
  WHERE reviewee_id = p_reviewee_id;
$$;

REVOKE ALL  ON FUNCTION public.get_reviewee_rating_stats(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_reviewee_rating_stats(uuid) TO authenticated;
