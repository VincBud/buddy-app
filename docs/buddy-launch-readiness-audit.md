# Buddy — Launch Readiness & App Store Blocker Audit

> Release-engineering audit of the current codebase/config. **No code or SQL was
> changed** producing this document. Priorities:
>
> - 🔴 **Must-fix before App Store** — Apple will reject, or the build can't ship.
> - 🟠 **Must-fix before public beta** — real users would hit broken/unsafe flows.
> - 🟡 **Should-fix before launch** — quality/trust; not a hard gate.
> - ⚪ **Nice-to-have later** — post-launch.
>
> Status of each item is a checkbox: check when resolved/verified.

_Audited: package.json, app.json, eas.json, app/_layout.tsx, lib/auth.ts,
services/auth.service.ts, services/identity-verification.service.ts,
services/notifications.service.ts, lib/geo-location.ts, app.json plugins,
image-picker usages, docs/buddy-mvp-qa-checklist.md._

---

## 0. Current configuration snapshot (facts)

- **Auth:** email **OTP / magic-link only** (`supabase.auth.signInWithOtp` / `verifyOtp`). **No Apple Login**, no social providers (`expo-apple-authentication` not installed).
- **Identity:** Persona via Edge Functions (`create-persona-inquiry`, `persona-webhook`); mandatory gate in `app/_layout.tsx`. Production Persona secrets **not yet confirmed**.
- **Geo:** `expo-location` installed; `app.json` has the config plugin with a foreground-only iOS usage string; Android fine/coarse only. ✅ Good.
- **Images:** `expo-image-picker` used in chat, profile, create, preferences (photo **library** only; no camera). ⚠️ **No `expo-image-picker` plugin / `NSPhotoLibraryUsageDescription` in `app.json`.**
- **Notifications:** in-app only (Supabase `notifications` table + `addNotification`). **`expo-notifications` not installed** — no OS push, no APNs/FCM config.
- **Identifiers:** `ios.bundleIdentifier = com.anonymous.buddy-app`, `android.package = com.anonymous.buddyapp` — **placeholder "anonymous"** template values.
- **EAS:** `eas.json` has `development` / `preview` / `production` build profiles + empty `submit.production`; `appVersionSource: remote`, production `autoIncrement`. EAS project id set; owner `vincbuds-organization`.
- **Version:** `1.0.0`; New Architecture on; `reactCompiler` experiment on.
- **Account deletion:** **no in-app delete-account flow found.**
- **Legal:** privacy policy page exists in the web app (`apps/web/.../datenschutz`).

---

## 1. 🔴 Must-fix before App Store submission

### Sign in with Apple
- [ ] **Add Apple Login.** Email-OTP is first-party (so Apple 4.8 may not strictly force it), **but the project has decided Apple Login is required** and it materially eases review for a social/marketplace app. Currently **absent**.
  - [ ] Install `expo-apple-authentication`; add the config plugin + iOS capability.
  - [ ] Wire to Supabase (`signInWithIdToken({ provider: 'apple' })`); enable Apple provider in Supabase Auth.
  - [ ] Ensure the created `profiles` row + verification gate work identically to the OTP path.
  - [ ] iOS: enable "Sign In with Apple" capability in the Apple Developer app id.

### Photo-library permission (image upload)
- [ ] **Add `NSPhotoLibraryUsageDescription`.** The app opens the photo library (chat/profile/create/preferences) but `app.json` has **no** usage string / image-picker plugin → iOS runtime crash on first access + guaranteed review rejection.
  - [ ] Add the `expo-image-picker` config plugin with a `photosPermission` string (DE/EN), or set `ios.infoPlist.NSPhotoLibraryUsageDescription`.
  - [ ] If camera capture is ever added, also add `NSCameraUsageDescription` (not currently needed — library only).

### App identifiers / branding
- [ ] **Replace placeholder bundle IDs** `com.anonymous.buddy-app` / `com.anonymous.buddyapp` with real reverse-domain IDs (permanent once shipped). Register the iOS app id + Android package accordingly.
- [ ] App display name, icon, and splash finalized for store.

### Account deletion (Apple 5.1.1(v))
- [ ] **Add an in-app "Delete account" flow.** Apps with account creation must let users delete the account **and** associated data in-app. None exists today → hard rejection.
  - [ ] Implement deletion (client entry + server-side user/data removal) and confirm cascades (`profiles`, `jobs`, `job_locations`, `messages`, `reviews`, `reports`) behave.

### Persona production readiness
- [ ] **Switch Persona from sandbox to production** with real template/API keys stored as Edge Function secrets (never in the client).
- [ ] Verify the production **webhook** endpoint + signing secret; confirm status transitions flip `profiles.verification_status` end-to-end on a real device.
- [ ] Confirm the mandatory-verification gate cannot be bypassed in a production build.

### iOS build / signing can actually be produced
- [ ] **Resolve the known Apple Developer account/team issues** so an EAS iOS build + submission is possible (team membership, certificates, provisioning, app id).
- [ ] Add real `submit.production` config (Apple ID / ASC app id / team id) in `eas.json`.
- [ ] Produce a **production** EAS build for both platforms and install/test on real hardware.

### App Privacy & data-use disclosures
- [ ] Complete Apple **App Privacy "nutrition label"** (location, photos, contact/email, user content, identifiers) matching real behavior.
- [ ] Provide the **privacy policy URL** (datenschutz) + **support contact** in App Store Connect.

---

## 2. 🟠 Must-fix before public beta (TestFlight / real users)

- [ ] **End-to-end happy path verified on real iOS + Android** (per `docs/buddy-mvp-qa-checklist.md` §16) — currently **untested at runtime**; this is the biggest unknown.
- [ ] **Persona works on real devices** (SDK launch, camera/ID capture, webhook round-trip).
- [ ] **Location capture verified on device** (grant/deny/timeout; create blocked without a fix; feed origin real — not Rosenheim).
- [ ] **Photo upload verified on device** (once the permission string is added) in chat/profile/create.
- [ ] **Privacy leak checks pass** (QA §15): authenticated `select * from job_locations` denied; `jobs.payload` has no exact `location`; `nearby_open_jobs` returns no lat/lng; reporter privacy holds.
- [ ] **No crash on denied permissions / no network / killed mid-chat**.
- [ ] **OTP email deliverability** confirmed from the production Supabase project (rate limits, sender domain).
- [ ] Rate limits active (apply / report) so beta testers can't trivially spam.

## 3. 🟡 Should-fix before launch

- [ ] **Push notifications.** Currently in-app only (`expo-notifications` not installed). Without push, users miss applications/acceptance/chat when the app is closed — significant for a real-time marketplace. Decide: ship in-app-only for MVP (document it) or add `expo-notifications` + APNs/FCM.
- [ ] **Reports triage path** operationalized (service_role dashboard/query + who monitors) before inviting the public.
- [ ] **Manual location fallback** — denying location currently blocks job creation and empties the feed (known limitation). Consider a manual city/postal entry so denied users aren't dead-ended.
- [ ] **Orphan-job edge** — if `set_job_location` fails after job creation, a job row exists without a `job_locations` row (invisible in feed, no cleanup). Add retry/draft/cleanup.
- [ ] **Legal in-app links** — surface Terms + Privacy + Impressum inside the app (not just the web app).
- [ ] **Payments/payout wording** — ensure placeholders don't imply live money movement if not shipped (avoids "misleading" rejection).
- [ ] **`newArchEnabled` + `reactCompiler`** — sanity-check all native modules (Persona SDK, expo-location, image-picker, datetimepicker) on the New Architecture in a production build.
- [ ] Confirm `npm run typecheck` + `npm run lint` clean in CI before each build.

## 4. ⚪ Nice-to-have later

- [ ] `profiles.home_geo` used as a feed-origin fallback.
- [ ] "Jobs outside your radius" hint (needs a server-side coarse count).
- [ ] Out-of-radius / manual pin / map UI for location.
- [ ] Additional sign-in providers (Google) — note: adding a social provider **does** trigger the Apple 4.8 Sign-in-with-Apple requirement (already covered above).
- [ ] Localization beyond DE/EN.
- [ ] In-app report status visibility for reporters.

---

## 5. Specific check results

| Area | Status | Note |
|---|---|---|
| Apple Login | 🔴 Missing | Email OTP only; no `expo-apple-authentication` |
| Persona secrets | 🔴 Pending | Move to production keys + webhook; secrets server-side only |
| EAS build readiness | 🟠 Partial | Profiles exist; Apple team/signing issues + empty `submit.production` |
| Location permission | ✅ OK | Foreground-only plugin + iOS usage string + Android fine/coarse |
| Camera/photo permission | 🔴 Missing | Photo library used; **no `NSPhotoLibraryUsageDescription`** |
| Push notifications | 🟡 Gap | In-app only; `expo-notifications` not installed |
| Account deletion | 🔴 Missing | Required by Apple 5.1.1(v) |
| Bundle identifiers | 🔴 Placeholder | `com.anonymous.*` must be rebranded |
| Privacy/security (geo, reports) | ✅ Strong (verify) | RLS + private side-table + coarse RPC; run QA §15 on device |
| Legal / privacy policy | 🟡 Partial | Web datenschutz exists; add in-app links + App Privacy labels |
| Runtime tested end-to-end | 🟠 Unknown | User cannot fully runtime-test yet — biggest risk |

---

## 6. Top launch blockers (do these first, in order)

1. 🔴 **Fix iOS signing / Apple Developer team** so any production build can even be made — everything else is unverifiable until this is unblocked.
2. 🔴 **Add `NSPhotoLibraryUsageDescription`** (image-picker config) — cheapest fix, prevents a guaranteed crash + rejection.
3. 🔴 **Add Sign in with Apple** (project-required; wire to Supabase).
4. 🔴 **Add in-app account deletion** (Apple 5.1.1(v)).
5. 🔴 **Persona → production** secrets + webhook verified on device.
6. 🔴 **Replace placeholder bundle IDs / finalize branding.**
7. 🟠 **Run the full QA checklist on real iOS + Android** once a build exists (nothing is proven until this passes).

## 7. Recommended next implementation step

**Unblock iOS builds first, then land the two cheapest hard blockers.** Concretely:
1. Resolve the Apple Developer team/signing so `eas build --profile production -p ios` succeeds (add `submit.production` config).
2. In the **same** config pass (native change → one rebuild), add the **`expo-image-picker` photo-permission string** and the **real bundle identifiers** to `app.json`.
3. Then implement **Sign in with Apple** and **account deletion** (both are prerequisites for submission and both need that working build to test).

Batching the `app.json` native changes (bundle IDs + photo permission, alongside the already-present location plugin) into one rebuild minimizes EAS iterations while you still have limited device-test access.
