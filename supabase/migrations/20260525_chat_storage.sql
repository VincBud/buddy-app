-- Chat image storage bucket.
--
-- Bucket is public (read): anyone with a URL can view the image.
-- Security model: image URLs are only exposed via public.messages rows, which
-- are already protected by RLS (participants only). Knowing the URL grants
-- read access, which is acceptable (same model as Slack/WhatsApp web).
--
-- Write is restricted by storage RLS: authenticated users may only upload to
-- paths where the second folder segment matches their own auth.uid().
-- Path format inside bucket: {jobId}/{senderId}/{filename}.jpg

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat',
  'chat',
  true,
  10485760,  -- 10 MB per file
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- INSERT: authenticated users may only write to chat/{jobId}/{their-own-uid}/...
CREATE POLICY "chat_images_insert_own"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'chat'
    AND auth.uid()::text = (storage.foldername(name))[2]
  );

-- UPDATE: authenticated users may only update their own files
CREATE POLICY "chat_images_update_own"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'chat'
    AND auth.uid()::text = (storage.foldername(name))[2]
  );

-- DELETE: authenticated users may only delete their own files
CREATE POLICY "chat_images_delete_own"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'chat'
    AND auth.uid()::text = (storage.foldername(name))[2]
  );
