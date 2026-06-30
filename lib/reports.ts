/**
 * Shared types + helpers for the Support / Report System.
 *
 * Mirrors the backend enums enforced by supabase/migrations/20260630_reports.sql
 * (public.reports CHECK constraints + public.submit_report). Keep these in sync
 * with that migration.
 */

export type ReportTargetType =
  | 'job'
  | 'user'
  | 'message'
  | 'completion'
  | 'payment'
  | 'general';

export type ReportReason =
  | 'harassment'
  | 'scam_fraud'
  | 'inappropriate_content'
  | 'no_show'
  | 'payment_issue'
  | 'safety_concern'
  | 'spam'
  | 'other';

export type ReportStatus = 'open' | 'reviewing' | 'resolved' | 'dismissed';

export const REPORT_TARGET_TYPES: readonly ReportTargetType[] = [
  'job', 'user', 'message', 'completion', 'payment', 'general',
] as const;

export const REPORT_REASONS: readonly ReportReason[] = [
  'harassment', 'scam_fraud', 'inappropriate_content', 'no_show',
  'payment_issue', 'safety_concern', 'spam', 'other',
] as const;

export const REPORT_STATUSES: readonly ReportStatus[] = [
  'open', 'reviewing', 'resolved', 'dismissed',
] as const;

/** Which reasons to surface per target type (ordered most→least relevant). */
const REASONS_BY_TARGET: Record<ReportTargetType, readonly ReportReason[]> = {
  job:        ['no_show', 'scam_fraud', 'safety_concern', 'harassment', 'other'],
  user:       ['harassment', 'scam_fraud', 'inappropriate_content', 'safety_concern', 'no_show', 'spam', 'other'],
  message:    ['harassment', 'inappropriate_content', 'spam', 'scam_fraud', 'other'],
  completion: ['no_show', 'scam_fraud', 'safety_concern', 'payment_issue', 'other'],
  payment:    ['payment_issue', 'scam_fraud', 'other'],
  general:    ['safety_concern', 'harassment', 'scam_fraud', 'inappropriate_content', 'payment_issue', 'spam', 'other'],
};

export const reasonsForTarget = (target: ReportTargetType): readonly ReportReason[] =>
  REASONS_BY_TARGET[target] ?? REPORT_REASONS;

export const isReportTargetType = (v: unknown): v is ReportTargetType =>
  typeof v === 'string' && (REPORT_TARGET_TYPES as readonly string[]).includes(v);

export const isReportReason = (v: unknown): v is ReportReason =>
  typeof v === 'string' && (REPORT_REASONS as readonly string[]).includes(v);

export const REPORT_NOTE_MAX_LENGTH = 2000;

// ── i18n key helpers ──────────────────────────────────────────────────────────

export const reportTitleKey  = (t: ReportTargetType) => `report.titles.${t}`;
export const reportIntroKey  = (t: ReportTargetType) => `report.intros.${t}`;
export const reportReasonKey = (r: ReportReason)      => `report.reasons.${r}`;
export const reportStatusKey = (s: ReportStatus)      => `report.statuses.${s}`;
export const reportErrorKey  = (code: string)         => `report.errors.${code}`;
