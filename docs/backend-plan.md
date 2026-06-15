# Buddy App — Backend Plan

Internal reference for the Supabase integration. Not public documentation.

---

## Planned Supabase Tables

| Table | Primary Key | Notes |
|-------|-------------|-------|
| `users` | `id` (uuid, FK → auth.users) | Display name, avatar URL, bio, categories, availability |
| `jobs` | `id` (uuid) | Full job record; `requester_id` FK → users |
| `job_applications` | `id` (uuid) | Buddy applications; `job_id` FK → jobs, `buddy_id` FK → users |
| `conversations` | `id` (uuid) | One per job; `job_id` unique FK → jobs |
| `messages` | `id` (uuid) | `conversation_id` FK → conversations, `sender_id` FK → users |
| `notifications` | `id` (uuid) | `recipient_id` FK → users; soft-deletable |
| `reviews` | `id` (uuid) | Reviewer + reviewee + job; unique per (reviewer, job) pair |
| `payments` | `id` (uuid) | One per job; mirrors `JobPaymentState`; `job_id` unique FK → jobs |
| `wallet_transactions` | `id` (uuid) | Immutable ledger; `user_id` FK → users |
| `reliability_stats` | `user_id` (uuid, PK) | Aggregated counters per user |
| `preferred_buddies` | composite (user_id, buddy_id) | Preferred buddy pairs |

---

## Row-Level Security (RLS)

> **Reminder:** Enable RLS on every table before going live.

Key policies to implement:

- `jobs`: Requester can insert/update own jobs. Buddies can read open jobs only.
- `job_applications`: Buddy can insert own applications. Requester can read applications for own jobs.
- `messages`: Only conversation participants (requester or matched buddy) can read/insert.
- `notifications`: Each user can only read/delete their own notifications.
- `reviews`: Users can only insert a review they are eligible to write; cannot update after insert.
- `payments`: Read-only for both parties; write only via server-side function or admin role.
- `wallet_transactions`: Insert via server function only. Users can read own rows.

---

## Storage Buckets

| Bucket | Access | Notes |
|--------|--------|-------|
| `job-media` | Authenticated upload; public read | Images/videos attached to job posts |
| `avatars` | Authenticated upload; public read | User profile pictures |

- Set file size limits (e.g. 10 MB per image, 50 MB per video).
- Validate MIME types server-side (don't trust client-provided content-type).
- Use signed URLs for any private bucket contents.

---

## Auth

- Use Supabase Auth with email + password for MVP.
- Keep `auth: { storage: AsyncStorage }` in the client config (required for React Native).
- On sign-in, write the Supabase `user.id` wherever `getActiveDevUserId()` is used today.
- The `_userId` param on every service function is pre-wired for this; just pass `session.user.id`.
- Consider phone/OTP auth as a second step (lower friction for the target demographic).

---

## Rate Limiting

- Enable Supabase's built-in rate limits for Auth endpoints (sign-up, password reset).
- For realtime subscriptions, cap channels per user to prevent abuse.
- Add application-level debounce on job posting (e.g. max 5 open jobs per user).
- If notifications become high-volume, queue them via a Postgres function + pg_cron rather than inserting directly from the client.

---

## Admin / Support Dashboard

- Use Supabase Studio for direct table access during early support.
- Build a lightweight internal admin panel (Next.js + Supabase service-role key, deployed separately) for:
  - Viewing and resolving reported issues (`job_issue_reports`)
  - Manually adjusting reliability stats
  - Triggering payouts or refunds
  - Searching users and jobs by id / email
- Do NOT expose the service-role key to the mobile client under any circumstances.

---

## Next.js Website

A companion Next.js site (`buddy-web`) is planned for:
- Marketing / landing page
- Job post public permalink (shareable link → deep-links into app)
- Email confirmation redirect pages (Supabase sends these)
- Password-reset flow (Supabase redirect target)
- Future: web app for requesters who prefer browser

The Next.js site should use the same Supabase project with its own anon key and separate RLS policies where needed.

---

## Migration Checklist (Local → Supabase)

- [ ] Install `@supabase/supabase-js` (`npx expo install @supabase/supabase-js`)
- [ ] Fill `.env.local` with real project URL + anon key
- [ ] Uncomment `createClient` block in `lib/supabase/client.ts`
- [ ] Enable RLS on all tables
- [ ] Swap each service body: search "SWAP:" across `services/`
- [ ] Wire real `session.user.id` into `_userId` params
- [ ] Set up storage buckets and policies
- [ ] Test on a staging Supabase project before production
- [ ] Rotate dev seed data out of production

---

## Auth — Development Build (Magic Links)

Expo Go does not support custom URL schemes. The `buddy://` deep link used in
magic link emails will not open in Expo Go — the device will show an error or
open a browser instead.

**Use a development build for all auth testing.**

### Build and run

```bash
npx expo run:ios
# or
npx expo run:android
```

### Test flow

1. Run the dev build on simulator or device.
2. Open the app and enter your email on the login screen.
3. Check your inbox for the Buddy magic link email.
4. Tap the link — it should open the app at `buddy://auth/callback?code=…`.
5. The callback screen exchanges the code for a Supabase session.
6. The app redirects to `/(tabs)` automatically.

### Supabase Dashboard — required setting

In **Authentication → URL Configuration**, add to **Redirect URLs**:

```
buddy://auth/callback
```

Without this, Supabase will reject the redirect as unauthorised.

### Scheme

The app scheme is `buddy` (`app.json → expo.scheme`).
The redirect URL is `buddy://auth/callback` (set in `lib/auth.ts → sendOtp`).

---

## Profiles Table — SQL Migration

Run in Supabase SQL Editor after the initial `profiles` table exists.

```sql
-- Extend profiles with onboarding fields
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS bio              text,
  ADD COLUMN IF NOT EXISTS skills           text[],
  ADD COLUMN IF NOT EXISTS radius_km        numeric,
  ADD COLUMN IF NOT EXISTS discovery_source text;
```

RLS policies are inherited from the existing `auth.uid() = id` policy — no additional policies needed for these columns.
