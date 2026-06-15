-- Extend review_job_application RPC to atomically update parent jobs row
-- When owner accepts an application, flip jobs.status='matched' + set assigned_buddy_id
-- This ensures the RPC runs first (server-side), then client echoes the result back

CREATE OR REPLACE FUNCTION public.review_job_application(
  p_job_id uuid,
  p_buddy_id uuid,
  p_decision text
)
RETURNS TABLE (
  id uuid,
  job_id uuid,
  buddy_id uuid,
  status text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_owner_id uuid;
BEGIN
  -- Verify job exists and caller is the owner
  SELECT j.creator_id INTO v_owner_id
    FROM public.jobs j WHERE j.id = p_job_id;

  IF NOT FOUND OR v_owner_id IS NULL THEN
    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_owner_id != auth.uid() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = 'P0001';
  END IF;

  -- Rate limit: 60 review decisions per hour per owner (M-1 protection)
  IF NOT public.check_rate_limit(auth.uid(), 'job_review', 60, 3600) THEN
    RAISE EXCEPTION 'rate_limit_exceeded' USING ERRCODE = 'P0001';
  END IF;

  -- Identity verification required (Phase 1)
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.identity_verified_at IS NOT NULL
      AND p.verification_status = 'approved'
  ) THEN
    RAISE EXCEPTION 'identity_verification_required' USING ERRCODE = 'P0001';
  END IF;

  -- Update the application row to reflect the decision
  UPDATE public.job_applications
     SET status = CASE
           WHEN p_decision = 'accepted' THEN 'accepted'
           WHEN p_decision = 'rejected' THEN 'rejected'
           ELSE status
         END,
         updated_at = now()
   WHERE job_id = p_job_id
     AND buddy_id = p_buddy_id;

  -- If accepting: flip parent jobs row to 'matched' + record assigned buddy
  IF p_decision = 'accepted' THEN
    UPDATE public.jobs
       SET status            = 'matched',
           assigned_buddy_id = p_buddy_id,
           updated_at        = now()
     WHERE id = p_job_id
       AND status IN ('open', 'paused');

    -- Atomically reject all other pending applications for this job
    UPDATE public.job_applications
       SET status = 'rejected',
           updated_at = now()
     WHERE job_id = p_job_id
       AND buddy_id != p_buddy_id
       AND status = 'pending';
  END IF;

  -- Return the updated application row
  RETURN QUERY
  SELECT ja.id, ja.job_id, ja.buddy_id, ja.status, ja.created_at, ja.updated_at
    FROM public.job_applications ja
   WHERE ja.job_id = p_job_id
     AND ja.buddy_id = p_buddy_id;
END;
$$;
