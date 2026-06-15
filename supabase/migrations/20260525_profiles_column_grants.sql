-- Narrow the UPDATE grant on public.profiles to only mutable columns.
--
-- The previous migration granted broad UPDATE on all columns, which would allow
-- an authenticated user to update system columns like id or created_at if RLS
-- were ever misconfigured. Column-level GRANTs act as a second enforcement layer.
--
-- id is excluded (immutable — PK and FK to auth.users).
-- created_at is excluded (set once on INSERT, never updated).
-- SELECT and INSERT grants are unchanged.

REVOKE UPDATE ON public.profiles FROM authenticated;

GRANT UPDATE (username, avatar_url, bio, skills, radius_km, discovery_source)
  ON public.profiles TO authenticated;
