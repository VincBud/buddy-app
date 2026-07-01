// delete-account
//
// In-app account deletion for App Store compliance (Apple 5.1.1(v)).
//
// The mobile client calls this function with its Supabase session JWT. The
// function:
//   1. Verifies the JWT via service_role and derives auth.uid() — the client
//      never supplies a user_id.
//   2. Blocks deletion while the user has a LIVE job (matched/active) as creator
//      or assigned buddy, so a counterparty's in-progress engagement is never
//      cascaded away. Returns 409 active_jobs_exist.
//   3. Preserves safety context for reports ABOUT the user (reported_user_id will
//      become NULL on delete) by stamping evidence_snapshot.deleted_subject.
//   4. Best-effort deletes the user's Storage objects (media + chat buckets) —
//      Storage does NOT cascade from auth.users. Failures are logged, not fatal.
//   5. Deletes the auth user LAST via admin.auth.admin.deleteUser(uid); the DB
//      FKs (ON DELETE CASCADE) remove the rest (profiles, jobs + their
//      applications/messages/reviews/job_locations, notifications, identity
//      verifications, rate limits, reports the user filed).
//
// Deploy:
//   supabase functions deploy delete-account
//
// Required env (auto-injected at runtime):
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Job statuses that represent a live engagement between two parties. Deleting an
// account with any of these would harm the counterparty, so we block.
const LIVE_JOB_STATUSES = ["matched", "active"];

// Storage buckets that hold user-uploaded files. The uploader's auth.uid() is a
// path segment in every object name (media: segment[3], chat: segment[2]); a
// `%/<uid>/%` match catches the user's files in both.
const USER_STORAGE_BUCKETS = ["media", "chat"];

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("delete-account missing required env vars");
    return jsonResponse({ error: "server_misconfigured" }, 500);
  }

  try {
    // ── 1. Verify the caller's JWT and derive uid ─────────────────────────
    const authHeader =
      req.headers.get("authorization") ?? req.headers.get("Authorization");
    if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }
    const jwt = authHeader.slice(7).trim();

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData?.user?.id) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }
    const userId = userData.user.id;

    // ── 2. Active-job safeguard ───────────────────────────────────────────
    const { data: liveJobs, error: liveErr } = await admin
      .from("jobs")
      .select("id")
      .or(`creator_id.eq.${userId},assigned_buddy_id.eq.${userId}`)
      .in("status", LIVE_JOB_STATUSES)
      .limit(1);

    if (liveErr) {
      console.error("delete-account: live-job check failed:", liveErr.message);
      return jsonResponse({ error: "unknown" }, 500);
    }
    if (liveJobs && liveJobs.length > 0) {
      return jsonResponse({ error: "active_jobs_exist" }, 409);
    }

    // ── 3. Reports safety retention (best-effort) ─────────────────────────
    // reported_user_id becomes NULL on cascade; stamp the subject into the
    // server-owned evidence_snapshot so abuse history survives anonymized.
    try {
      const { data: subjectReports, error: reportsErr } = await admin
        .from("reports")
        .select("id, evidence_snapshot")
        .eq("reported_user_id", userId);

      if (reportsErr) {
        console.error("delete-account: report retention read failed:", reportsErr.message);
      } else if (subjectReports && subjectReports.length > 0) {
        const nowIso = new Date().toISOString();
        for (const r of subjectReports) {
          const base = (r.evidence_snapshot ?? {}) as Record<string, unknown>;
          const merged = {
            ...base,
            deleted_subject: {
              deleted_subject_user_id: userId,
              previous_reported_user_id: userId,
              deleted_subject_at: nowIso,
            },
          };
          const { error: updErr } = await admin
            .from("reports")
            .update({ evidence_snapshot: merged })
            .eq("id", r.id);
          if (updErr) {
            console.error(`delete-account: report ${r.id} retention update failed:`, updErr.message);
          }
        }
      }
    } catch (e) {
      console.error("delete-account: report retention step threw:", e instanceof Error ? e.message : String(e));
    }

    // ── 4. Storage cleanup (best-effort, non-blocking) ────────────────────
    for (const bucket of USER_STORAGE_BUCKETS) {
      try {
        // The `storage` schema is exposed to service_role; if not, this throws
        // and we log + continue (orphaned files can be swept later).
        const { data: objects, error: listErr } = await admin
          .schema("storage")
          .from("objects")
          .select("name")
          .eq("bucket_id", bucket)
          .ilike("name", `%/${userId}/%`);

        if (listErr) {
          console.error(`delete-account: storage list failed (${bucket}):`, listErr.message);
          continue;
        }
        const names = (objects ?? []).map((o: { name: string }) => o.name);
        if (names.length > 0) {
          const { error: rmErr } = await admin.storage.from(bucket).remove(names);
          if (rmErr) {
            console.error(`delete-account: storage remove failed (${bucket}):`, rmErr.message);
          }
        }
      } catch (e) {
        console.error(`delete-account: storage cleanup threw (${bucket}):`, e instanceof Error ? e.message : String(e));
      }
    }

    // TODO(apple-token-revocation): Apps using Sign in with Apple must call
    // Apple's token revocation endpoint (POST https://appleid.apple.com/auth/revoke)
    // when a user deletes their account. Implement once the Apple provider
    // credentials (Services ID, key/.p8, Team ID) and per-user Apple refresh/
    // access token storage are finalized. Until then this is a known compliance gap.

    // ── 5. Delete the auth user LAST (cascades all remaining DB rows) ──────
    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr) {
      console.error("delete-account: deleteUser failed:", delErr.message);
      return jsonResponse({ error: "delete_user_failed" }, 500);
    }

    return jsonResponse({ ok: true }, 200);
  } catch (e) {
    console.error("delete-account: unhandled error:", e instanceof Error ? e.message : String(e));
    return jsonResponse({ error: "unknown" }, 500);
  }
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}
