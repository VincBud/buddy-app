# Buddy Support / Report System — Implementation Plan

> **Status: PLANNING ONLY.** This document describes a proposed design. No app code,
> SQL, RLS, migrations, or services have been created or modified as part of it.
> It exists to align on scope before implementation begins.

---

## 1. Current codebase findings

### Architecture facts that shape the design

- **No `conversations` table.** `job_id` *is* the conversation key (1:1 with a job).
  See `supabase/migrations/20260521_messages.sql`:
  `messages(id uuid, job_id uuid FK→jobs, sender_id uuid, …)`. Any "report a message"
  must carry both `message_id` and its `job_id`.
- **No cross-user / public profile screen exists.** `supabase/migrations/20260525_profiles.sql`
  is **owner-only SELECT** — every read is `id = auth.uid()`. So *"report a user"* cannot
  live on a profile page; it must be **contextual** (from a job's applicant list or a chat).
- **An overlapping "report" already exists but is a different thing.**
  `app/chat-details/[id].tsx` calls `reportJobIssue` from `lib/job-actions` — this is a
  **job-dispute / resolution workflow** (flips job status to `problemReported`, then
  continue / cancel / complete). It is **not** a trust & safety moderation report and writes
  no moderation record. ⚠️ **Do not conflate the two.** The new system is abuse / safety
  reporting routed to admins; keep the names distinct (e.g. `reportJobIssue` = dispute,
  new `submitReport` = T&S).
- **No admin / moderator / role infrastructure exists.** The only privileged path is
  `service_role` (used by the Persona Edge Functions). MVP admin handling must therefore be
  service_role-based, not an in-app admin role.
- **Established security conventions to mirror** (from `supabase/migrations/20260525_reviews.sql`):
  - Participant checks use `jobs.creator_id` / `job_applications.status = 'accepted'` via
    `EXISTS`, **never** client JSONB payloads.
  - `REVOKE ALL FROM anon`, narrow `GRANT` to `authenticated`, RLS owner-scoped, no
    UPDATE/DELETE grants on immutable records.
  - `SECURITY DEFINER … SET search_path = public` for aggregates / privileged reads.
  - Rate limiting already exists: `supabase/migrations/20260608_m1_rate_limiting.sql` — reuse it.
  - RPC-for-writes precedent: `supabase/migrations/20260526_apply_to_job_rpc.sql`.

### Where IDs / context are already available in the UI

| Screen | Available context |
|--------|-------------------|
| `app/job/[id].tsx` | `job.id`, `creator_id`, `assigned_buddy_id`, `application.buddyId` (per applicant), `activeUserId`, header bar slots |
| `app/chat-details/[id].tsx` | `jobId`, job + both participants, `currentUserRole`, header bar |
| `app/chat.tsx` | per-message `message.id`, `jobId`, sender — rendered in a list (`key={message.id}`) → enables long-press-to-report |
| `app/review/[jobId].tsx` | `jobId`, reviewee — natural place for "report instead of review" |
| `app/(tabs)/profile.tsx` | own user only → home for **General support request** entry, not user-reporting |

### Existing tables & services relevant to reporting

- **jobs** → `services/jobs.service.ts` (`creator_id`, `assigned_buddy_id`, `status`)
- **profiles** → `services/profiles.service.ts` (owner-only)
- **messages** → `services/conversations.service.ts` (`job_id`, `sender_id`)
- **reviews** → `services/reviews.service.ts` (`insertReview`, rating-stats RPC)
- **job_applications** → `services/job-requests.service.ts` (`buddy_id`, `status = 'accepted'`)

---

## 2. MVP scope

A **single polymorphic `reports` table** + one **`submit_report` RPC** + one **service file**
+ **contextual entry points**. Admin handling = service_role read via the Supabase dashboard /
secure query (no in-app admin UI yet). Deliberately small:

- ✅ Report Job, User, Message, Completion, Payment-placeholder, General support.
- ✅ Reporter can view *their own* submitted reports + status.
- ✅ Server-side participant validation + rate limiting + dedupe.
- ❌ No admin dashboard, no in-app moderation actions, no reporter↔reported messaging, no
  auto-suspension. Those are post-MVP.

---

## 3. Proposed `reports` table

A single polymorphic table — simplest to secure and query (six separate tables = 6× the RLS
surface for no real benefit at MVP).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK `gen_random_uuid()` | |
| `reporter_id` | uuid NOT NULL FK→auth.users ON DELETE CASCADE | always `auth.uid()` |
| `target_type` | text NOT NULL CHECK in enum | `job` \| `user` \| `message` \| `completion` \| `payment` \| `general` |
| `reported_user_id` | uuid NULL FK→auth.users ON DELETE SET NULL | for `user`/`message`/derived |
| `job_id` | uuid NULL FK→jobs ON DELETE SET NULL | for `job`/`message`/`completion`/`payment` |
| `message_id` | uuid NULL FK→messages ON DELETE SET NULL | for `message` |
| `reason` | text NOT NULL CHECK in enum | see §8 |
| `note` | text NULL | free text, length-capped (e.g. ≤ 2000) |
| `evidence_snapshot` | jsonb NULL | **server-built copy** of reported message body / job title at report time (messages are soft-deletable) |
| `status` | text NOT NULL DEFAULT `'open'` CHECK in enum | see §8 |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |
| `updated_at` | timestamptz NOT NULL DEFAULT now() | admin-updated |

Constraints / indexes:

- `CHECK (reporter_id <> reported_user_id)` — no self-report of user.
- `CHECK` enforcing required ids per `target_type` (e.g. `message` ⇒ `message_id` & `job_id`
  not null; `user` ⇒ `reported_user_id` not null).
- Partial unique index for **dedupe**:
  `UNIQUE (reporter_id, target_type, COALESCE(message_id, job_id, reported_user_id))`
  filtered on `status = 'open'` to stop spam re-reports.
- Indexes: `(status, created_at DESC)` for triage, `(reported_user_id)` for
  "reports against a user" aggregation, `(reporter_id)`.

---

## 4. Proposed RLS rules

Mirror `supabase/migrations/20260525_reviews.sql` exactly in style.

- `REVOKE ALL ON public.reports FROM anon;`
- `GRANT SELECT, INSERT ON public.reports TO authenticated;` — **no UPDATE/DELETE grant** to
  users (immutable from the client; status changes are service_role-only).
- **SELECT** `reports_select_own`: `USING (reporter_id = auth.uid())` — reporters see only
  their own reports. Reported users must **not** see reports about them.
- **INSERT** `reports_insert_own` `WITH CHECK`:
  - `reporter_id = auth.uid()` (never spoofable), **and**
  - **context validation per type**:
    - `job` / `completion` / `payment` → reporter is a participant of `job_id`
      (`creator_id = auth.uid()` **OR** accepted buddy via `job_applications`), reusing the
      reviews / messages `EXISTS` pattern.
    - `message` → reporter is a participant of the message's `job_id`, and
      `message_id.job_id = job_id`.
    - `user` → reporter and `reported_user_id` **share a job** (either party as creator /
      accepted buddy) — prevents reporting strangers.
    - `general` → no target required; any verified authenticated user.
- **UPDATE / DELETE**: no policy ⇒ blocked for clients. Status transitions happen via
  service_role only.
- **Verification gate**: since identity verification is mandatory, consider requiring
  `verification_status = 'approved'` to file non-`general` reports (reduces throwaway-account
  abuse) — but allow `general` support without it so blocked users can still reach support.

> Because the participant checks are non-trivial, do them inside the **SECURITY DEFINER RPC**
> (§5) and keep the direct-INSERT policy as a strict backstop.

---

## 5. Proposed `submit_report` RPC

**`public.submit_report(...)` — `SECURITY DEFINER, SET search_path = public`**
(precedent: `supabase/migrations/20260526_apply_to_job_rpc.sql`). Centralizes:

1. participant / context validation (same `EXISTS` logic as the RLS policy),
2. rate limiting via the existing `supabase/migrations/20260608_m1_rate_limiting.sql` helper
   (e.g. N reports / hour / user),
3. dedupe (rely on the partial unique index; return the existing id gracefully),
4. building `evidence_snapshot` **server-side** so the client can't forge evidence,
5. deriving `reported_user_id` from the message's `sender_id` / the job counterparty rather
   than trusting the client.

- `GRANT EXECUTE … TO authenticated;` only.

**Optional `get_my_reports()`** — a thin wrapper over the SELECT policy (or just query the
table directly; RLS already scopes it). Not strictly needed for MVP.

**App service — new `services/reports.service.ts`** mirroring `services/reviews.service.ts`:

```
submitReport(params) -> Outcome   // wraps the RPC; typed reason/targetType/status enums
fetchMyReports()                  // for a "My reports" list (optional in MVP)
```

Plus shared enums / types in `lib/reports.ts` (target types, reasons, statuses, i18n key maps).

---

## 6. UI entry points

| Entry point | Location | Target type |
|-------------|----------|-------------|
| Header overflow (⋯) → "Melden" | `app/job/[id].tsx` header | `job` |
| Applicant row action → "Nutzer melden" | `app/job/[id].tsx` application list (`application.buddyId`) | `user` |
| Header overflow in chat | `app/chat-details/[id].tsx` (distinct from existing "Problem melden" dispute button) | `user` |
| **Long-press a message** → "Nachricht melden" | `app/chat.tsx` (`message.id`) | `message` |
| Completion / review flow → "Problem mit Abschluss melden" | `app/review/[jobId].tsx` | `completion` |
| Wallet → "Zahlungsproblem melden" (placeholder) | `app/wallet.tsx` | `payment` |
| Profile → "Hilfe & Support" | `app/(tabs)/profile.tsx` | `general` |

**New screen / modal:** one reusable `app/report.tsx` (modal route) taking
`{ targetType, jobId?, messageId?, reportedUserId? }` params → reason picker + note + submit +
success state. Reuse the existing reason/picker modal styling already present in
`chat-details` to stay visually consistent. Add a read-only `app/support.tsx` (or a profile
sub-section) listing "My reports" + status, plus a general-support form.

---

## 7. Implementation phases

1. **Schema + RLS + RPC** (one migration `*_reports.sql`): table, enums (CHECKs), indexes,
   GRANTs, RLS policies, `submit_report` RPC with rate-limit + dedupe + evidence snapshot.
2. **Service + types**: `lib/reports.ts`, `services/reports.service.ts`, i18n keys
   (DE primary, EN).
3. **Reusable report modal** (`app/report.tsx`) + success / error states.
4. **Wire entry points** one surface at a time: chat message → job → user → completion →
   general / payment.
5. **"My reports" view** + general support form.
6. **Admin handling (MVP)**: a saved service_role SQL view / Supabase dashboard query for
   triage, and a small secure Edge Function or SQL snippet to set `status`
   (`open → reviewing → resolved / dismissed`). No app UI.
7. *(Post-MVP)* admin dashboard, in-app moderation actions, block / mute, notifications to the
   reporter on resolution.

---

## 8. Report reasons & statuses

**Reasons** (enum; surface a per-target subset in the UI):
`harassment` · `scam_fraud` · `inappropriate_content` · `no_show` · `payment_issue` ·
`safety_concern` · `spam` · `other`.

**Statuses** (admin-controlled): `open` → `reviewing` → `resolved` | `dismissed`
(4 states for MVP).

---

## 9. Risks & edge cases

- **Evidence disappears**: messages are soft-deletable
  (`supabase/migrations/20260525_messages_no_hard_delete.sql`) and jobs cascade-delete.
  Snapshot reported content **server-side** at submit time into `evidence_snapshot`; use
  `ON DELETE SET NULL` so reports survive target deletion.
- **Reporter privacy**: reported users must never see who reported them, or that a report
  exists — enforced by `reports_select_own` (no policy exposing rows to `reported_user_id`).
- **Abuse / mass-reporting**: rate-limit + partial-unique dedupe; require shared-job context
  for `user` / `message` / `job` reports; consider requiring verified identity for non-general
  reports.
- **Spoofing**: never trust client-supplied `reported_user_id` / evidence — derive from
  `messages.sender_id` / the job counterparty inside the RPC.
- **Self-report / non-participant**: blocked by CHECK + EXISTS validation.
- **GDPR / retention**: the public `apps/web/app/datenschutz/page.tsx` is the privacy policy —
  reports contain personal data + free-text accusations. Define a retention window and update
  the policy before launch; ensure cascade behavior aligns with account-deletion
  ("right to erasure").
- **Naming collision** with the existing `reportJobIssue` dispute flow — pick distinct labels /
  i18n keys to avoid user and developer confusion.
- **Access for blocked / suspended users**: keep `general` support reachable even if other
  features are gated, so users can always contact support.
- **Notification noise**: don't notify the reported party; optionally notify the reporter only
  on `resolved` / `dismissed` (post-MVP).

---

## 10. Files likely changed later (during implementation)

**New**

- `supabase/migrations/<date>_reports.sql` (table, enums, RLS, GRANTs, `submit_report` RPC)
- `lib/reports.ts` (types, reason / status enums, i18n maps)
- `services/reports.service.ts`
- `app/report.tsx` (reusable report modal route)
- `app/support.tsx` (general support + "my reports") *(or a profile sub-screen)*

**Modified**

- `app/_layout.tsx` (register the `report` modal route)
- `app/job/[id].tsx` (header ⋯ + applicant row action)
- `app/chat.tsx` (long-press message → report)
- `app/chat-details/[id].tsx` (header report-user entry)
- `app/review/[jobId].tsx` (report-completion entry)
- `app/wallet.tsx` (payment-issue placeholder)
- `app/(tabs)/profile.tsx` ("Hilfe & Support" entry)
- `lib/i18n.ts` (DE + EN keys: reasons, statuses, screen copy)
- `apps/web/app/datenschutz/page.tsx` (privacy-policy update for report data retention)

---

> **Reminder:** This is a planning document only. The next concrete step is **Phase 1** — the
> `reports` table + `submit_report` RPC — since every UI surface depends on its shape.
