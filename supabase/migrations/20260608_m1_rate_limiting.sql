-- M-1 Rate Limiting Layer
--
-- Protect against abuse of expensive or spam-prone actions:
-- - job creation
-- - job applications
-- - chat messages
-- - reviews
--
-- Uses a sliding-window counter approach with automatic cleanup.
-- Each action increments an attempt counter keyed by (user_id, action, window_start).
-- If counter exceeds limit, the check fails and the action is blocked.

-- ── Rate Limit Tracking Table ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.rate_limit_checks (
  id                 bigserial PRIMARY KEY,
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action             text NOT NULL,
  window_start       timestamptz NOT NULL,
  attempt_count      integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, action, window_start)
);

-- Index for efficient cleanup of expired windows
CREATE INDEX IF NOT EXISTS rate_limit_checks_window_start_idx
  ON public.rate_limit_checks (window_start);

-- Index for query efficiency
CREATE INDEX IF NOT EXISTS rate_limit_checks_user_action_idx
  ON public.rate_limit_checks (user_id, action);

-- ── Rate Limit Check Function ───────────────────────────────────────────────
--
-- Checks if user_id has exceeded rate limit for action within window.
-- Returns true if allowed (under limit), false if exceeded.
--
-- Arguments:
--   p_user_id: UUID of the authenticated user (derived from auth.uid())
--   p_action: action name (e.g., 'job_post', 'job_apply', 'chat_message')
--   p_limit: max attempts allowed in window
--   p_window_seconds: window size in seconds

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_user_id uuid,
  p_action text,
  p_limit integer,
  p_window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start timestamptz;
  v_count integer;
BEGIN
  -- Derive window start for the current time
  v_window_start := date_trunc('second', now() - (p_window_seconds || ' seconds')::interval)
                    + (p_window_seconds || ' seconds')::interval;

  -- Try to increment the counter in the current window
  INSERT INTO public.rate_limit_checks (user_id, action, window_start, attempt_count)
  VALUES (p_user_id, p_action, v_window_start, 1)
  ON CONFLICT (user_id, action, window_start) DO UPDATE
  SET attempt_count = rate_limit_checks.attempt_count + 1
  RETURNING attempt_count INTO v_count;

  -- Return true if under limit, false if exceeded
  RETURN v_count <= p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.check_rate_limit(uuid, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(uuid, text, integer, integer) TO authenticated;

-- ── Cleanup Old Rate Limit Records ──────────────────────────────────────────
--
-- Removes rate limit records older than 24 hours (prevents table growth).
-- Can be invoked manually or via pg_cron in production.

CREATE OR REPLACE FUNCTION public.cleanup_old_rate_limits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.rate_limit_checks
  WHERE created_at < now() - interval '24 hours';
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_old_rate_limits() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_old_rate_limits() TO authenticated;

-- ── Reload PostgREST schema ────────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';
