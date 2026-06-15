/**
 * Media service — Supabase Storage uploads.
 *
 * Bucket: 'media' (public)
 * Job attachments: jobs/{jobId}/{userId}/{timestamp}-{random}.{ext}
 * Chat images:     chats/{jobId}/{userId}/{timestamp}-{random}.{ext}
 *
 * Image pipeline:
 *   All still images (HEIC, JPEG, PNG, WEBP) are pushed through
 *   expo-image-manipulator with a target maxWidth and JPEG compression in a
 *   single step, returning the resulting bytes via base64. This:
 *     - converts HEIC → JPEG (RN <Image> can't render remote HEIC),
 *     - resizes to a sensible viewing width (1280px for job posts, 1080px
 *       for chat) so 4-12 MB camera photos collapse to ~150-400 KB,
 *     - avoids the disk read entirely (ImageManipulator's temp file may be
 *       released before fetch() can read it; base64 sidesteps the race).
 *
 * Videos (mp4/mov) bypass the manipulator and upload as-is via
 * ExpoFile.arrayBuffer() — fetch().blob() returns 0-byte blobs for local
 * file:// URIs in React Native.
 *
 * Storage INSERT policy: (storage.foldername(name))[3] = auth.uid()
 */

import { File as ExpoFile } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';

import { isSupabaseConfigured } from '../lib/config/env';
import { debugLog } from '../lib/config/debug';
import { supabase } from '../lib/supabase/client';

const BUCKET = 'media';

// Compression targets. Job posts get more room because the detail page can
// fill an iPad; chat bubbles are capped at ~360px on screen so 1080 is plenty.
const JOB_MAX_WIDTH = 1280;
const CHAT_MAX_WIDTH = 1080;
const JPEG_QUALITY = 0.75;

export type MediaUploadResult = {
  path: string;
  publicUrl: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif']);
const VIDEO_EXTS = new Set(['mp4', 'mov']);

const getFileExtension = (uri: string): string => {
  const ext = uri.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext) ? ext : 'jpg';
};

const getMimeType = (ext: string): string => {
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg',
    png: 'image/png',  gif: 'image/gif',  webp: 'image/webp',
    mp4: 'video/mp4',  mov: 'video/quicktime',
  };
  return map[ext] ?? 'image/jpeg';
};

const isImageUri = (uri: string): boolean =>
  IMAGE_EXTS.has((uri.split('?')[0].split('.').pop() ?? '').toLowerCase());

const safeFileSize = (uri: string): number | undefined => {
  try {
    // expo-file-system OOP File exposes .size synchronously; wrap defensively
    // because some URI schemes may throw.
    const f = new ExpoFile(uri);
    const s = (f as unknown as { size?: number }).size;
    return typeof s === 'number' && s > 0 ? s : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Resize + compress an image and return raw JPEG bytes.
 *
 * Returns an ArrayBuffer (not Uint8Array). React Native's fetch implementation
 * does not reliably serialise typed-array views — passing a Uint8Array body
 * to @supabase/supabase-js produces 0-byte PUTs on some code paths.
 *
 * Always emits JPEG. Always passes through ImageManipulator regardless of
 * source format — uniform code path, gives consistent dimensions/bytes, and
 * normalises camera-roll content URIs the same way HEIC was already handled.
 */
const processImageToBytes = async (
  localUri: string,
  maxWidth: number
): Promise<ArrayBuffer> => {
  const t0 = Date.now();
  const originalBytes = safeFileSize(localUri);

  const result = await ImageManipulator.manipulateAsync(
    localUri,
    [{ resize: { width: maxWidth } }],
    { format: ImageManipulator.SaveFormat.JPEG, compress: JPEG_QUALITY, base64: true }
  );

  if (!result.base64) {
    throw new Error('[media] ImageManipulator returned no base64 — cannot upload image');
  }

  const binaryString = atob(result.base64);
  const buffer = new ArrayBuffer(binaryString.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < binaryString.length; i++) {
    view[i] = binaryString.charCodeAt(i);
  }

  const ratio = originalBytes ? `${(buffer.byteLength / originalBytes * 100).toFixed(0)}%` : 'n/a';
  debugLog(
    `[media] processed maxWidth=${maxWidth} originalBytes=${originalBytes ?? '?'} ` +
    `outBytes=${buffer.byteLength} ratio=${ratio} q=${JPEG_QUALITY} (${Date.now() - t0}ms)`
  );
  return buffer;
};

// ─── Core upload ──────────────────────────────────────────────────────────────

const readFileAsArrayBuffer = async (localUri: string): Promise<ArrayBuffer> => {
  const file = new ExpoFile(localUri);
  return await file.arrayBuffer();
};

const uploadToStorage = async (
  body: ArrayBuffer,
  storagePath: string,
  mime: string
): Promise<string> => {
  if (body.byteLength === 0) {
    throw new Error(`upload produced 0 bytes — file unreadable at path=${storagePath}`);
  }

  const tPut = Date.now();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, body, { contentType: mime, upsert: false });
  debugLog(`[media] PUT path=${storagePath} bytes=${body.byteLength} (${Date.now() - tPut}ms)`);

  if (error) throw error;

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(data.path);
  return urlData.publicUrl;
};

/**
 * Convert a local image/video URI into JPEG bytes (or raw video bytes) and
 * upload them to Supabase Storage at the given prefix. Returns the public URL.
 *
 * onPhase fires twice — `'optimizing'` before resize/compress, `'uploading'`
 * before the PUT — so callers can drive a stepped progress label.
 */
const processAndUpload = async (
  localUri: string,
  storageDir: string,
  maxWidth: number,
  opts?: { onPhase?: (phase: 'optimizing' | 'uploading') => void }
): Promise<{ path: string; publicUrl: string }> => {
  if (!isSupabaseConfigured || localUri.startsWith('http')) {
    return { path: localUri, publicUrl: localUri };
  }

  const t0 = Date.now();
  const ext = getFileExtension(localUri);
  const isVideo = VIDEO_EXTS.has(ext);

  let body: ArrayBuffer;
  let uploadExt: string;
  let uploadMime: string;

  if (isVideo) {
    opts?.onPhase?.('uploading');
    body = await readFileAsArrayBuffer(localUri);
    uploadExt = ext;
    uploadMime = getMimeType(ext);
  } else if (isImageUri(localUri) || ext === 'jpg') {
    opts?.onPhase?.('optimizing');
    body = await processImageToBytes(localUri, maxWidth);
    uploadExt = 'jpg';
    uploadMime = 'image/jpeg';
    opts?.onPhase?.('uploading');
  } else {
    // Unknown extension — best-effort raw upload
    opts?.onPhase?.('uploading');
    body = await readFileAsArrayBuffer(localUri);
    uploadExt = ext;
    uploadMime = getMimeType(ext);
  }

  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${uploadExt}`;
  const storagePath = `${storageDir}/${filename}`;

  const publicUrl = await uploadToStorage(body, storagePath, uploadMime);
  debugLog(`[media] upload total path=${storagePath} (${Date.now() - t0}ms)`);
  return { path: storagePath, publicUrl };
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Upload a local image/video attached to a job during job creation.
 * Images are resized to 1280px wide and re-encoded as JPEG.
 */
export const uploadJobMedia = async (
  localUri: string,
  jobId: string,
  userId: string,
  opts?: { onPhase?: (phase: 'optimizing' | 'uploading') => void }
): Promise<MediaUploadResult> => {
  try {
    return await processAndUpload(localUri, `jobs/${jobId}/${userId}`, JOB_MAX_WIDTH, opts);
  } catch (e) {
    console.warn('[media] uploadJobMedia FAILED', localUri.slice(-60), e);
    throw e;
  }
};

/** Backward-compat alias — imported as uploadMedia in create.tsx */
export const uploadMedia = uploadJobMedia;

/**
 * Upload a local image sent as a chat attachment.
 * Images are resized to 1080px wide and re-encoded as JPEG.
 * Throws on failure — caller (chat.tsx) marks the message as failed.
 */
export const uploadChatImage = async (
  localUri: string,
  jobId: string,
  senderId: string
): Promise<string> => {
  if (!isSupabaseConfigured) throw new Error('Supabase not configured');
  if (localUri.startsWith('http')) return localUri;
  try {
    const { publicUrl } = await processAndUpload(
      localUri,
      `chats/${jobId}/${senderId}`,
      CHAT_MAX_WIDTH
    );
    return publicUrl;
  } catch (e) {
    console.warn('[media] uploadChatImage FAILED', localUri.slice(-60), e);
    throw e;
  }
};
