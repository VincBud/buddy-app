# Backend Readiness Audit

_Last updated: 2026-05-06_

---

## Summary

The frontend is largely backend-ready. Service boundaries are clean, auth is real (Supabase Magic Link), and every service function carries a `_userId` stub parameter ready to receive `session.user.id`. The main work is swapping AsyncStorage bodies for Supabase calls inside `services/` and `lib/job-actions.ts`.

---

## Current Frontend-Only Systems

| System | Where | Migration effort |
|---|---|---|
| Jobs CRUD | `services/jobs.service.ts` → AsyncStorage | Low — swap body per function |
| Job actions (accept, complete, cancel, dispute) | `lib/job-actions.ts` → AsyncStorage.multiGet/multiSet | Medium — atomic writes need transactions or RPC |
| Conversations / messages | `services/conversations.service.ts` → AsyncStorage | Low + add Realtime subscription |
| Notifications | `services/notifications.service.ts` → AsyncStorage | Low + move writes server-side |
| User profile & score | `services/user.service.ts` → AsyncStorage | Low — mostly 1:1 with `reliability_stats` table |
| Wallet / transactions | `services/wallet.service.ts` → AsyncStorage | Medium — ledger inserts must be server-side |
| Preferred buddies | `services/buddies.service.ts` → AsyncStorage | Low |
| Media uploads | `services/media.service.ts` → local URI stub | Low — SWAP comments already in place |
| Reliability stats | `services/user.service.ts` → AsyncStorage per userId | Low — maps to `reliability_stats` table |

---

## Required Supabase Tables

| Table | Notes |
|---|---|
| `profiles` | **Live** — `ensureProfile` / `updateProfile` already write to this |
| `jobs` | Full `Job` shape; `creator_id` FK → auth.users |
| `job_applications` | One row per buddy application per job |
| `conversations` | One per job (`job_id` unique FK) |
| `messages` | `conversation_id` FK, `sender_id` FK, `content`, `type`, `created_at` |
| `notifications` | `recipient_id` FK, `type`, `title`, `message`, `read`, `related_job_id` |
| `reviews` | `reviewer_id`, `reviewee_id`, `job_id`, `rating`, `review_text`; unique per (reviewer, job) |
| `payments` | One per job; mirrors `JobPaymentState`; write via server function only |
| `wallet_transactions` | Immutable ledger; insert via server function / webhook only |
| `reliability_stats` | Aggregated counters per user; update via RPC |
| `preferred_buddies` | Composite PK (user_id, buddy_id) |
| `job_issue_reports` | Audit log for reported disputes |
| `job_cancellations` | Audit log for cancellation events |

---

## Required RLS Policies

| Table | Policy |
|---|---|
| `jobs` | Owner: full CRUD where `creator_id = auth.uid()`. Buddy: SELECT where `status = 'open'` only |
| `job_applications` | Buddy: INSERT own rows. Owner: SELECT where job belongs to them |
| `conversations` | SELECT/INSERT for matched requester or selected buddy only |
| `messages` | SELECT/INSERT for conversation participants only |
| `notifications` | SELECT/UPDATE/DELETE where `recipient_id = auth.uid()` |
| `reviews` | INSERT once per (reviewer, job). No UPDATE after insert |
| `payments` | SELECT for job participants. INSERT/UPDATE via service-role only |
| `wallet_transactions` | SELECT where `user_id = auth.uid()`. INSERT via service-role only |
| `reliability_stats` | SELECT public. UPDATE via server RPC only |

---

## Realtime Subscriptions Needed

| Channel | Trigger | Consuming screen |
|---|---|---|
| `notifications` INSERT | New notification for user | Tab badge, notifications list |
| `messages` INSERT | New message in conversation | chat.tsx |
| `jobs` UPDATE | Status change on matched job | chat.tsx, job/[id].tsx, feed |
| `job_applications` INSERT | New buddy applied | notifications (owner side) |

Replace the current `eventBus` with Supabase Realtime channel subscriptions at the same call sites in `services/notifications.service.ts` and `services/conversations.service.ts`.

---

## Supabase Edge Functions / Server-Side Requirements

These must NOT be done client-side in production:

| Operation | Why server-side |
|---|---|
| Write `wallet_transactions` | Ledger integrity; client must not self-report earnings |
| Trigger Stripe payment authorization | Secret key; never exposed to client |
| Release payment to buddy | Webhook from Stripe → Edge Function → DB update |
| Issue refund | Same — Stripe webhook driven |
| Insert `notifications` for other users | Client cannot write another user's notifications row (RLS) |
| Aggregate `reliability_stats` | Prevent self-inflation; use `increment_reliability_stat` RPC |

---

## Known Risks Before Backend Switch

| Risk | Mitigation |
|---|---|
| `lib/job-actions.ts` uses `AsyncStorage.multiGet/multiSet` directly — bypasses `jobs.service.ts` | Refactor to use `upsertJob` + a new `saveAuditRecord` service before migration |
| `HOME_SEEN_COUNT_KEY` in `app/(tabs)/index.tsx` is an unregistered storage key | Register in `STORAGE_KEYS` or drop when replaced by server-side session tracking |
| `APP_LANGUAGE` written directly from `profile.tsx` | Move into `user.service.setUserPreferences` |
| `chat_${jobId}` message keys are not in `STORAGE_KEYS` | `chatKey()` in conversations.service is the only reference — acceptable for now |
| `buddy_score` stored flat; will collide if two users share a device | Keyed per `userId` after real auth — `getBuddyScore` currently uses a global key |
| Local dev seeds (seed jobs with `requesterId = 'local_user'`) will not match real UUIDs | Purge seed data before first real-user test |
| `profiles` table live but other tables don't exist yet — mixed data sources | Keep each service stub isolated; do not mix AsyncStorage + Supabase reads in same function |

---

## Supabase SQL Editor — run order

Run these scripts in the Supabase SQL Editor in order.
Each file is idempotent (safe to re-run):

1. `supabase/migrations/20260506_jobs.sql` — creates jobs table, trigger, indexes
2. `supabase/migrations/20260506_jobs_rls_fix.sql` — drops and recreates all jobs RLS policies (run this if you see _"permission denied for table jobs"_)
3. `supabase/migrations/20260506_job_applications.sql` — creates job_applications table + RLS

---

## Migration Order

1. **Auth** — already live. Confirm `getActiveUserId()` returns real UUID in all flows.
2. **Profiles** — already live (`ensureProfile`, `updateProfile`).
3. **Jobs table** — live (`jobs.service.ts` dual-write active). Run `20260506_jobs_rls_fix.sql` if feed is blocked.
4. **Job applications** — live (`job-requests.service.ts` dual-write active). Run `20260506_job_applications.sql`.
5. **Conversations + messages** — swap `conversations.service.ts`; add Realtime listener.
6. **Notifications** — swap `notifications.service.ts`; move write-side to Edge Functions.
7. **Reliability stats** — swap `user.service.ts` stat functions; add `increment_reliability_stat` RPC.
8. **Payments** — swap payment state; wire Stripe webhooks to Edge Functions.
9. **Wallet** — swap `wallet.service.ts`; wire earning inserts to job-completion webhook.
10. **Reviews** — swap review writes in `job-actions.ts`; add unique constraint on (reviewer_id, job_id).
