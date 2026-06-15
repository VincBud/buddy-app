-- ============================================================
-- Buddy App — Supabase Storage: media bucket
-- Run once via Supabase SQL editor or supabase db push
-- ============================================================
-- Bucket layout (all in the 'media' bucket):
--   jobs/{jobId}/{userId}/{timestamp}-{random}.{ext}   — job attachments
--   chats/{jobId}/{userId}/{timestamp}-{random}.{ext}  — chat images
--
-- The 3rd path segment is ALWAYS the uploading user's auth.uid().
-- INSERT policy enforces this.  Public bucket → no auth needed for reads.
-- ============================================================

-- 1. Create the bucket (idempotent)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'media',
  'media',
  true,           -- public: getPublicUrl works without signed tokens
  10485760,       -- 10 MB per file
  ARRAY[
    'image/jpeg', 'image/jpg', 'image/png',
    'image/webp', 'image/gif',
    'image/heic', 'image/heif',
    'video/mp4',  'video/quicktime'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public             = true,
  file_size_limit    = 10485760,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. Drop stale policies first so re-runs are idempotent
DROP POLICY IF EXISTS "media_insert_own"  ON storage.objects;
DROP POLICY IF EXISTS "media_select_pub"  ON storage.objects;
DROP POLICY IF EXISTS "media_delete_own"  ON storage.objects;

-- 3. Authenticated users may upload only to their own uid folder
--    (storage.foldername(name))[3] extracts the 3rd path segment:
--      jobs/{jobId}/{userId}/file  → segment 3 = userId  ✓
--      chats/{jobId}/{userId}/file → segment 3 = userId  ✓
CREATE POLICY "media_insert_own"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'media'
    AND (storage.foldername(name))[3] = auth.uid()::text
  );

-- 4. Public SELECT (bucket is public — CDN serves without RLS for GET)
--    Explicit policy ensures authenticated clients can also SELECT via client.
CREATE POLICY "media_select_pub"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'media');

-- 5. Users may delete only their own uploads
CREATE POLICY "media_delete_own"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'media'
    AND (storage.foldername(name))[3] = auth.uid()::text
  );
