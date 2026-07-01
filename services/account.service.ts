/**
 * Account service — irreversible account deletion via the delete-account
 * Edge Function (supabase/functions/delete-account).
 *
 * The client NEVER deletes auth.users directly. This calls the JWT-verified,
 * service_role Edge Function which enforces the active-job safeguard, retains
 * report safety context, cleans up storage, and deletes the auth user (which
 * cascades the rest). No user_id is sent — the server derives it from the JWT.
 *
 * The public function never throws — it returns a typed outcome.
 */
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../lib/supabase/client';

export type DeleteAccountErrorCode =
  | 'unauthorized'
  | 'active_jobs_exist'
  | 'delete_user_failed'
  | 'unknown';

export type DeleteAccountOutcome =
  | { ok: true }
  | { ok: false; code: DeleteAccountErrorCode };

const KNOWN_ERROR_CODES: readonly DeleteAccountErrorCode[] = [
  'unauthorized', 'active_jobs_exist', 'delete_user_failed', 'unknown',
];

export const deleteAccount = async (): Promise<DeleteAccountOutcome> => {
  try {
    const { data: sessionRes } = await supabase.auth.getSession();
    const token = sessionRes.session?.access_token;
    if (!token) {
      return { ok: false, code: 'unauthorized' };
    }

    const res = await fetch(`${SUPABASE_URL}/functions/v1/delete-account`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
      // No body — the Edge Function derives the user from the JWT.
    });

    let body: { ok?: boolean; error?: string } | null = null;
    try { body = await res.json(); } catch { /* non-JSON response */ }

    if (res.ok && body?.ok === true) {
      return { ok: true };
    }

    const raw = body?.error;
    const code: DeleteAccountErrorCode =
      (KNOWN_ERROR_CODES as readonly string[]).includes(raw ?? '')
        ? (raw as DeleteAccountErrorCode)
        : 'unknown';
    console.warn(`[account.service] deleteAccount failed: status=${res.status} code=${code}`);
    return { ok: false, code };
  } catch (e) {
    console.warn('[account.service] deleteAccount threw:', e instanceof Error ? e.message : String(e));
    return { ok: false, code: 'unknown' };
  }
};
