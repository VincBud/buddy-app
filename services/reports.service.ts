/**
 * Reports service — thin wrapper around the public.submit_report RPC
 * (supabase/migrations/20260630_reports.sql).
 *
 * The RPC derives reporter_id from auth.uid(), validates participant access,
 * derives reported_user_id + evidence server-side, rate-limits, and de-dupes.
 * This client never decides any of that; it only forwards the target context.
 *
 * The public function never throws — every path returns a typed outcome.
 */
import { supabase } from '../lib/supabase/client';
import type { ReportReason, ReportStatus, ReportTargetType } from '../lib/reports';

export interface SubmitReportParams {
  targetType: ReportTargetType;
  reason: ReportReason;
  note?: string | null;
  jobId?: string | null;
  messageId?: string | null;
  reportedUserId?: string | null;
}

export interface SubmitReportResult {
  reportId: string;
  status: ReportStatus;
  createdAt: string;
  /** true when an identical open report already existed (returned, not re-created). */
  deduplicated: boolean;
}

/** Known P0001 error codes raised by submit_report, plus a catch-all. */
export type SubmitReportErrorCode =
  | 'not_authenticated'
  | 'invalid_target_type'
  | 'invalid_reason'
  | 'note_too_long'
  | 'rate_limit_exceeded'
  | 'identity_verification_required'
  | 'job_id_required'
  | 'job_not_found'
  | 'message_not_found'
  | 'reported_user_required'
  | 'not_a_participant'
  | 'no_shared_context'
  | 'cannot_report_self'
  | 'unknown';

export type SubmitReportOutcome =
  | { ok: true; result: SubmitReportResult }
  | { ok: false; code: SubmitReportErrorCode };

const KNOWN_ERROR_CODES: readonly SubmitReportErrorCode[] = [
  'not_authenticated', 'invalid_target_type', 'invalid_reason', 'note_too_long',
  'rate_limit_exceeded', 'identity_verification_required', 'job_id_required',
  'job_not_found', 'message_not_found', 'reported_user_required',
  'not_a_participant', 'no_shared_context', 'cannot_report_self',
];

interface SubmitReportRow {
  report_id: string;
  status: ReportStatus;
  created_at: string;
  deduplicated: boolean;
}

/**
 * Submit a report. Returns a typed outcome; never throws.
 */
export const submitReport = async (
  params: SubmitReportParams,
): Promise<SubmitReportOutcome> => {
  try {
    const { data, error } = await supabase.rpc('submit_report', {
      p_target_type: params.targetType,
      p_reason: params.reason,
      p_note: params.note?.trim() ? params.note.trim() : null,
      p_job_id: params.jobId ?? null,
      p_message_id: params.messageId ?? null,
      p_reported_user_id: params.reportedUserId ?? null,
    });

    if (error) {
      // RAISE EXCEPTION '<code>' surfaces as error.message (see apply_to_job).
      const code: SubmitReportErrorCode =
        (KNOWN_ERROR_CODES as readonly string[]).includes(error.message)
          ? (error.message as SubmitReportErrorCode)
          : 'unknown';
      console.warn(`[reports.service] submit_report failed: code=${error.code} message="${error.message}"`);
      return { ok: false, code };
    }

    const row = (Array.isArray(data) ? data[0] : data) as SubmitReportRow | undefined;
    if (!row?.report_id) {
      console.warn('[reports.service] submit_report returned no row');
      return { ok: false, code: 'unknown' };
    }

    return {
      ok: true,
      result: {
        reportId: row.report_id,
        status: row.status,
        createdAt: row.created_at,
        deduplicated: !!row.deduplicated,
      },
    };
  } catch (e) {
    console.warn('[reports.service] submit_report threw:', e instanceof Error ? e.message : String(e));
    return { ok: false, code: 'unknown' };
  }
};
