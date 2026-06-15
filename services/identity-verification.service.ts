/**
 * Identity verification service — thin wrappers around the Persona-backed
 * Edge Functions and SQL helpers.
 *
 * Server pieces this depends on (already deployed):
 *   - Edge Function `create-persona-inquiry`  (JWT-verified; returns inquiry_id, session_token, status)
 *   - SQL RPC      `get_my_verification_status` (returns the caller's verification state)
 *   - Column       `public.profiles.verification_status`
 *
 * The mobile client never holds a Persona API key. All inquiry initiation
 * goes through the Edge Function, which derives reference_id from auth.uid().
 */
import { supabase } from '../lib/supabase/client';

export type VerificationStatus =
  | 'not_started'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'manual_review'
  | 'expired';

export interface VerificationState {
  identityVerifiedAt: string | null;
  verificationStatus: VerificationStatus;
  verificationProvider: string | null;
  verificationLastAttemptAt: string | null;
}

export interface StartInquiryResult {
  inquiryId: string | null;
  referenceId: string | null;
  status: string;          // 'created' | 'pending' | 'already_verified' | ...
  sessionToken: string | null;
  reused: boolean;
  retryCount: number;
}

export type StartInquiryError =
  | { kind: 'not_authenticated' }
  | { kind: 'cooldown'; retryAfterSeconds: number }
  | { kind: 'retry_limit_reached'; retryCount: number }
  | { kind: 'server_error'; detail?: string };

export type StartInquiryOutcome =
  | { ok: true; result: StartInquiryResult }
  | { ok: false; error: StartInquiryError };

/**
 * Ask the backend to create (or reuse) a Persona inquiry for the
 * authenticated user. Returns enough data for the SDK to launch.
 */
export const startVerificationInquiry = async (): Promise<StartInquiryOutcome> => {
  try {
    console.log('[IDENTITY_VERIFICATION] startVerificationInquiry: getSession()…');
    const { data: sessionRes } = await supabase.auth.getSession();
    console.log('[IDENTITY_VERIFICATION] session present =', !!sessionRes.session,
      'access_token len =', sessionRes.session?.access_token?.length ?? 0,
      'user_id =', sessionRes.session?.user?.id ?? null);
    if (!sessionRes.session?.access_token) {
      console.log('[IDENTITY_VERIFICATION] no access_token → not_authenticated');
      return { ok: false, error: { kind: 'not_authenticated' } };
    }

    console.log('[IDENTITY_VERIFICATION] invoking Edge Function "create-persona-inquiry"…');
    const { data, error } = await supabase.functions.invoke<Record<string, unknown>>(
      'create-persona-inquiry',
      { method: 'POST' }
    );
    console.log('[IDENTITY_VERIFICATION] functions.invoke returned:');
    console.log('[IDENTITY_VERIFICATION]   data =', JSON.stringify(data, null, 2));
    console.log('[IDENTITY_VERIFICATION]   error =', error ? JSON.stringify({
      message: error.message,
      name: error.name,
      context: (error as { context?: unknown }).context ?? null,
    }, null, 2) : 'null');

    if (error) {
      // supabase-js exposes the HTTP status via FunctionsHttpError; fall back
      // to a generic server_error if we can't classify it.
      const status = (error as { context?: { status?: number } }).context?.status;
      const body = (error as { context?: { body?: unknown } }).context?.body;
      const parsed = parseErrorBody(body);
      console.log('[IDENTITY_VERIFICATION] edge function error status =', status,
        'parsed body =', JSON.stringify(parsed));

      if (status === 429 && parsed?.error === 'verification_cooldown') {
        return {
          ok: false,
          error: {
            kind: 'cooldown',
            retryAfterSeconds: Number(parsed.retry_after_seconds) || 30,
          },
        };
      }
      if (status === 429 && parsed?.error === 'verification_retry_limit_reached') {
        return {
          ok: false,
          error: {
            kind: 'retry_limit_reached',
            retryCount: Number(parsed.retry_count) || 0,
          },
        };
      }
      return {
        ok: false,
        error: { kind: 'server_error', detail: parsed?.error ?? error.message },
      };
    }

    if (!data || typeof data !== 'object') {
      console.log('[IDENTITY_VERIFICATION] empty/non-object data → server_error');
      return { ok: false, error: { kind: 'server_error', detail: 'empty_response' } };
    }

    const result: StartInquiryResult = {
      inquiryId: typeof data.inquiry_id === 'string' ? data.inquiry_id : null,
      referenceId: typeof data.reference_id === 'string' ? data.reference_id : null,
      status: typeof data.status === 'string' ? data.status : 'pending',
      sessionToken: typeof data.session_token === 'string' ? data.session_token : null,
      reused: data.reused === true,
      retryCount: typeof data.retry_count === 'number' ? data.retry_count : 0,
    };
    console.log('[IDENTITY_VERIFICATION] parsed StartInquiryResult:', JSON.stringify(result, null, 2));
    return { ok: true, result };
  } catch (e) {
    console.log('[IDENTITY_VERIFICATION] startVerificationInquiry caught exception');
    console.log('[IDENTITY_VERIFICATION]   name:', e instanceof Error ? e.name : typeof e);
    console.log('[IDENTITY_VERIFICATION]   message:', e instanceof Error ? e.message : String(e));
    console.log('[IDENTITY_VERIFICATION]   stack:', e instanceof Error ? e.stack : '(no stack)');
    return {
      ok: false,
      error: { kind: 'server_error', detail: e instanceof Error ? e.message : 'unknown' },
    };
  }
};

/**
 * Read the caller's verification state via the SQL RPC. This is the
 * authoritative server-side source; the webhook is what flips `approved`.
 */
export const fetchVerificationStatus = async (): Promise<VerificationState | null> => {
  try {
    const { data, error } = await supabase.rpc('get_my_verification_status');
    if (error || !data) return null;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return {
      identityVerifiedAt: row.identity_verified_at ?? null,
      verificationStatus: normalizeStatus(row.verification_status),
      verificationProvider: row.verification_provider ?? null,
      verificationLastAttemptAt: row.verification_last_attempt_at ?? null,
    };
  } catch {
    return null;
  }
};

/**
 * Poll fetchVerificationStatus until it reaches a terminal state or the
 * timeout elapses. Used after the SDK closes so the screen can react
 * without forcing the user to tap a refresh button. The webhook may take
 * a few seconds to fire from Persona's side.
 */
export const pollVerificationStatus = async (options?: {
  intervalMs?: number;
  timeoutMs?: number;
  signal?: { aborted: boolean };
}): Promise<VerificationState | null> => {
  const intervalMs = options?.intervalMs ?? 3000;
  const timeoutMs = options?.timeoutMs ?? 60_000;
  const deadline = Date.now() + timeoutMs;

  let lastState: VerificationState | null = null;
  while (Date.now() < deadline) {
    if (options?.signal?.aborted) return lastState;
    const state = await fetchVerificationStatus();
    if (state) {
      lastState = state;
      if (state.verificationStatus !== 'pending' && state.verificationStatus !== 'not_started') {
        return state;
      }
    }
    await sleep(intervalMs);
  }
  return lastState;
};

export const isApproved = (state: VerificationState | null): boolean =>
  !!state && state.verificationStatus === 'approved' && !!state.identityVerifiedAt;

// ── Internals ────────────────────────────────────────────────────────────────

const VALID_STATUSES: ReadonlySet<VerificationStatus> = new Set([
  'not_started', 'pending', 'approved', 'rejected', 'manual_review', 'expired',
]);

const normalizeStatus = (value: unknown): VerificationStatus => {
  if (typeof value === 'string' && VALID_STATUSES.has(value as VerificationStatus)) {
    return value as VerificationStatus;
  }
  return 'not_started';
};

const parseErrorBody = (body: unknown): Record<string, unknown> | null => {
  if (!body) return null;
  if (typeof body === 'object') return body as Record<string, unknown>;
  if (typeof body === 'string') {
    try { return JSON.parse(body); } catch { return null; }
  }
  return null;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
