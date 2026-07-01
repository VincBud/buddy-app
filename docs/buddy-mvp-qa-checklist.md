# Buddy — MVP Manual QA Checklist

> Pre-launch / app-store readiness checklist. Manual testing only — this document
> changes no app code or SQL. Check items off as you verify them on a real build.
>
> **Legend:** DB checks assume you query Supabase as `service_role` (SQL editor).
> Client checks assume the app running on a **development/EAS build** (not Expo Go —
> Persona SDK + `expo-location` are native).

---

## 1. Test setup

- [ ] Build installed is a **dev-client or EAS build** (Persona + expo-location need native modules).
- [ ] Correct environment: `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` point at the intended (staging vs prod) project.
- [ ] All Geo + Reports migrations applied (PostGIS enabled; `job_locations`, `set_job_location`, `nearby_open_jobs`, `reports`, `submit_report` exist).
- [ ] Persona is configured (Edge Functions `create-persona-inquiry` + `persona-webhook` deployed; webhook reachable).
- [ ] Supabase SQL editor access available for DB verification.
- [ ] Device location services ON; app location permission resettable (delete/reinstall or OS settings).
- [ ] Language toggle available; run key flows in **DE and EN**.
- [ ] Known test coordinates handy (e.g. two points a known distance apart) for radius testing.

## 2. Accounts / devices needed

- [ ] **Account A** — job creator (verified).
- [ ] **Account B** — buddy/helper (verified), physically/logically "near" A's job location.
- [ ] **Account C** — a second buddy (for multi-applicant + decline testing).
- [ ] **Account U** — unverified account (to test gates + general support access).
- [ ] At least **2 physical devices** (or 1 device + 1 simulator) so A and B can interact live (chat, accept, complete).
- [ ] iOS **and** Android coverage for permission prompts, Persona SDK, and image picker.
- [ ] A way to fake/set location per device (real travel, simulator custom location, or dev override).

---

## 3. Auth / Profile / Onboarding

- [ ] Sign up / magic-link (or configured method) succeeds; session persists across app restart.
- [ ] `auth/callback` deep link handles the magic link without bouncing to `/welcome`.
- [ ] First sign-in creates a `profiles` row (`ensureProfile`).
- [ ] Onboarding requires: username, ≥3 skills, radius set — cannot skip.
- [ ] Editing display name / bio persists and reflects immediately.
- [ ] Sign out returns to `/welcome`; no stale data leaks into the next account.
- [ ] **DB:** `select id, username, skills, radius_km from profiles where id = '<A>';` → expected values, `array_length(skills,1) >= 3`.

## 4. Identity verification (Persona — mandatory)

- [ ] Unverified user is routed to `/identity-verification` and **cannot** reach the main tabs.
- [ ] `not_started` → CTA "Verifizierung starten" launches Persona SDK.
- [ ] Completing Persona flips status; app polls and routes into `/(tabs)` on approval.
- [ ] `pending` → CTA "Verifizierung fortsetzen" resumes the **existing** inquiry (no duplicate created).
- [ ] `rejected` → "Erneut versuchen"; `expired` → "Neu starten"; `manual_review` → refresh-only (no relaunch).
- [ ] Cooldown / retry-limit / server errors show friendly copy (no raw codes).
- [ ] SDK unavailable (e.g. Expo Go) is blocked **before** creating an inquiry (no wasted retry).
- [ ] Verified user is never shown the verification gate again.
- [ ] **DB:** `select verification_status, identity_verified_at from profiles where id = '<A>';` → `approved` + non-null timestamp after success.
- [ ] **Gate check:** unverified user cannot create a job / apply / review (server rejects with `identity_verification_required`).

## 5. Geo / location

- [ ] First feed/create use triggers the OS location prompt **only after** a user action (not on cold launch).
- [ ] Location-settings: "Zugriff aktivieren" fires the real OS prompt; card reflects true OS status on focus.
- [ ] Denied → "In Einstellungen öffnen" opens system settings; re-grant then refresh works.
- [ ] Radius slider (1–50 km) persists and affects nearby results.
- [ ] Grant → create + feed use the **real device** location (not Rosenheim).
- [ ] Denied + no cache → create is **blocked** with `create.location_unavailable`; feed shows "Standort benötigt" empty state.
- [ ] Cached last-known location used as fallback when a live fix isn't available.
- [ ] **No hardcoded Rosenheim** anywhere: `grep -rn "47.856\|12.128" app/` returns nothing.
- [ ] **DB privacy:** exact coords never in a client-readable place (see §16).

## 6. Job creation

- [ ] Create requires category, problem text, price; validation blocks empty/invalid.
- [ ] Media: up to 3 images upload; failures degrade gracefully (job still posts).
- [ ] Location captured **before** the job row is created (deny location → **no** `jobs` row).
- [ ] Successful post → navigates to feed; form resets.
- [ ] `set_job_location` failure after create → `create.location_error`, no navigation (known orphan-row edge, see §18).
- [ ] **DB — location stored privately:**
  - `select job_id, ST_Y(geo::geometry) lat, ST_X(geo::geometry) lng, geo_precision, city, postal_code from job_locations order by created_at desc limit 1;` → real point.
- [ ] **DB — payload has NO exact location:**
  - `select payload ? 'location' as has_exact, payload->'location_summary' as summary from jobs order by created_at desc limit 1;` → `has_exact = false`, summary = `{city, postal_code, geo_precision}`.

## 7. Feed / nearby matching

- [ ] Open ("Offen") tab lists **open** jobs near the buddy, ordered by relevance (category match → price → distance).
- [ ] Distance chip shows a real "min · km" (or "<1 km" / "Nearby"), never raw coordinates.
- [ ] Own jobs never appear in the feed.
- [ ] Jobs already applied to never appear.
- [ ] Shrinking radius reduces results; widening increases them.
- [ ] Pull-to-refresh re-queries; loading / empty / error states behave.
- [ ] RPC error → friendly toast, no crash, no raw code.
- [ ] Accepted / Pending / Archived tabs populate from local data and work without location.
- [ ] **DB:** `select * from nearby_open_jobs(<lat>, <lng>, 20);` (as authenticated user) returns `distance_km` + coarse `city`, **no lat/lng**.

## 8. Applications

- [ ] Buddy can apply to an open job; button reflects pending state; cannot double-apply.
- [ ] Cannot apply to own job (server guard).
- [ ] Cannot apply to a non-open job.
- [ ] Rate limit respected (excessive applies blocked with friendly copy).
- [ ] Creator sees the new applicant (notification + list).
- [ ] **DB:** `select job_id, buddy_id, status from job_applications where job_id = '<job>';` → `pending` row for the buddy.

## 9. Acceptance / matching

- [ ] Creator accepts one applicant → job status → `matched`; `assigned_buddy_id` set.
- [ ] Declining another applicant sets that application to `rejected`; buddy notified.
- [ ] Once matched, the job leaves the public feed for other buddies.
- [ ] Accepted buddy gains chat access; non-participants do not.
- [ ] **DB:** `select status, assigned_buddy_id from jobs where id = '<job>';` and `select buddy_id, status from job_applications where job_id='<job>';` → one `accepted`, others `rejected`.

## 10. Chat

- [ ] Both participants can open the conversation (job_id is the conversation key).
- [ ] Text messages send/receive in near-real-time; ordering + timestamps correct.
- [ ] Image messages upload and render on the other device (remote URL, not local `file://`).
- [ ] Optimistic "sending" → "sent"/"failed" states behave; failed can retry.
- [ ] Read state / unread counts update.
- [ ] Non-participants cannot read the conversation (RLS).
- [ ] System messages (matched/active/completed) appear at the right transitions.
- [ ] **DB:** `select id, job_id, sender_id, (image_url is not null) as has_image from messages where job_id='<job>' order by created_at;`.

## 11. Notifications

- [ ] New application → creator notified.
- [ ] Accept / decline → buddy notified.
- [ ] Job problem/cancel/resolve events notify the right party.
- [ ] Completion + review prompts notify appropriately.
- [ ] Tapping a notification deep-links to the correct job/chat.
- [ ] No notification leaks to non-participants.
- [ ] **DB:** `select type, user_id, application_id, read_at from notifications order by created_at desc limit 10;`.

## 12. Completion

- [ ] Either party can initiate completion; both must confirm.
- [ ] After both confirm → job status `completed`; earnings/points recorded for the buddy.
- [ ] Completed job moves to Archived; leaves active views.
- [ ] Reliability stats increment for both parties.
- [ ] **DB:** `select status, owner_completed_at, buddy_completed_at from jobs where id='<job>';` → status `completed`, both timestamps set.

## 13. Reviews

- [ ] Both parties can review after completion; ratings 1–5 + optional text.
- [ ] Cannot review before completion; cannot self-review; cannot review twice (unique pair).
- [ ] Reviewee's aggregate rating updates.
- [ ] Only participants can read individual reviews; aggregates exposed via RPC only.
- [ ] **DB:** `select job_id, reviewer_id, reviewee_id, rating from reviews where job_id='<job>';` → distinct reviewer/reviewee, valid rating.

## 14. Support / Reports

- [ ] **Report Job** — from job details ("Auftrag melden") → reasons filtered for `job`; submit → success.
- [ ] **Report Message** — long-press a *counterpart's* message → "Nachricht melden" → success (own/system messages not long-pressable).
- [ ] **Report User** — from chat details ("Nutzer melden") → targets the counterparty, never self; hidden when no counterparty.
- [ ] **General Support** — Profile → "Hilfe & Support" → works even for **unverified** users.
- [ ] Duplicate open report on same target returns the "Bereits gemeldet" dedup message.
- [ ] Submitting with no reason is blocked with friendly copy.
- [ ] Non-general reports require verified identity; general does not.
- [ ] Reporter can't report themselves; can't report strangers (no shared job context) — friendly errors, no raw codes.
- [ ] Distinct from the existing "Problem melden" dispute flow (both still work).
- [ ] **DB:** `select target_type, reason, status, reported_user_id, job_id, message_id, evidence_snapshot->>'kind' from reports order by created_at desc limit 10;` → correct target ids, `status='open'`, server-built evidence.

## 15. Privacy / security checks

- [ ] **Exact job coordinates are never client-readable:** as an authenticated user (PostgREST/anon key), `select * from public.job_locations;` → **permission denied**.
- [ ] `jobs.payload` never contains `location` (only coarse `location_summary`). Re-verify §6 DB check across several jobs.
- [ ] `nearby_open_jobs` output contains **no** lat/lng/geo columns.
- [ ] Reported users cannot see reports about them: `reports` SELECT only returns rows where `reporter_id = auth.uid()`.
- [ ] Cross-user profile reads are blocked (profiles are owner-only).
- [ ] Messages/reviews readable by participants only (attempt cross-account read → denied).
- [ ] Buddy's own location is not persisted to any world-readable row.
- [ ] No secrets/keys in the client bundle beyond the public anon key.
- [ ] Rate limits active on: apply, report, (job create if enabled).

## 16. Regression checks

- [ ] Full happy path end-to-end: A posts → B sees nearby → B applies → A accepts → chat (text+image) → both complete → both review. No errors.
- [ ] Offline / no-session: local tabs still render; nearby feed shows the location/needs state without crashing.
- [ ] App backgrounding/foregrounding mid-flow keeps state sane.
- [ ] Language switch (DE↔EN) across every screen — no missing keys / raw `key.path` strings.
- [ ] `npm run typecheck` passes.
- [ ] `npm run lint` shows no **new** errors.
- [ ] Deep links (job, chat, review, report) resolve correctly.
- [ ] Existing dispute flow ("Problem melden" / cancel / resolve) still works.

## 17. Known limitations (verify they behave as designed, not as bugs)

- [ ] No manual location fallback yet — denying location blocks job creation and empties the nearby feed (by design).
- [ ] Out-of-radius "widen your radius" hint is disabled (feed can't see beyond radius post-RPC).
- [ ] `profiles.home_geo` exists but isn't yet used as a feed origin.
- [ ] Orphan-job edge: if `set_job_location` fails **after** job creation, a job row can exist without a `job_locations` row (no auto-cleanup yet).
- [ ] Coordinates in staging may be uniform if testers share a location — distance ordering looks flat (expected).

## 18. Launch blockers (must ALL be clear before store submission)

- [ ] Mandatory identity verification cannot be bypassed to reach core features.
- [ ] Exact location never leaks to clients (§15 all pass).
- [ ] End-to-end happy path (§16) works on **both** iOS and Android.
- [ ] Persona flow works on a real device (production Persona config).
- [ ] Location permission strings present + accurate on both platforms; foreground-only (no background claim).
- [ ] Reports reach a triage path (service_role/dashboard) and reporter privacy holds.
- [ ] No crash on: denied location, denied camera/photos, no network, killed mid-chat.
- [ ] App-store metadata: privacy policy (datenschutz) reflects location + report data; permission usage descriptions match behavior.
- [ ] typecheck + lint clean; no debug-only logs dumping PII.
- [ ] Payments/payout placeholders don't imply live money movement if not shipped.

---

### Sign-off
- [ ] iOS pass complete — tester / date: ____________________
- [ ] Android pass complete — tester / date: ____________________
- [ ] All launch blockers cleared — approver / date: ____________________
