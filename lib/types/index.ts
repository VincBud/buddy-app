/**
 * Shared type barrel.
 *
 * Import domain types from here instead of from individual lib files.
 * This gives services and UI a stable, single-import-path that survives
 * internal refactors and makes the Supabase swap easier.
 *
 * Types are re-exported — nothing is moved. Existing imports continue to work.
 */

// ─── Jobs ────────────────────────────────────────────────────────────────────
export type {
  Job,
  JobStatus,
  TimeMode,
  JobCategory,
  JobApplicationState,
  JobMatchState,
  JobIssueSummary,
  JobCancellationSummary,
  JobMarketSignals,
  JobReview,
  JobRoleReview,
  JobRebooking,
  JobRebookingStatus,
  JobParticipantRole,
  IssueResolutionOutcome,
  JobExpiryUrgency,
} from '../jobs';

export type { JobRequest, JobRequestStatus } from '../job-request';

// ─── Users ───────────────────────────────────────────────────────────────────
export type { BuddyUser } from '../user-model';
export type { UserProfile } from '../user-profile';
export type { UserPreferences, AvailabilitySlot } from '../preferences';
export type { UserReliabilityStats, ReliabilitySignal } from '../trust';

// ─── Auth ────────────────────────────────────────────────────────────────────
export type { AuthUser } from '../../services/auth.service';

// ─── Conversations & Messages ────────────────────────────────────────────────
export type {
  Conversation,
  ConversationStatus,
  Message,
  MessageType,
  MessageSenderRole,
} from '../conversation';
export type { StoredMessage } from '../../services/conversations.service';

// ─── Notifications ───────────────────────────────────────────────────────────
export type {
  Notification,
  NotificationType,
  NotificationPreferences,
  NotificationPreferenceKey,
  NotificationTone,
  NotificationPresentation,
} from '../notifications';

// ─── Payments ────────────────────────────────────────────────────────────────
export type {
  JobPaymentState,
  PaymentStatus,
  PayoutStatus,
  RefundStatus,
  PaymentActorRole,
} from '../payments';
export type { PriceBreakdown, PriceValidationResult } from '../pricing';

// ─── Reviews ─────────────────────────────────────────────────────────────────
export type { ReviewEligibility, ReviewAvailabilityState } from '../reviews';
