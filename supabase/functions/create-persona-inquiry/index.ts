// create-persona-inquiry
//
// Server-initiated Persona inquiry creation. The mobile client calls this
// function with its Supabase session JWT; the function then:
//
//   1. Verifies the JWT via service_role and extracts auth.uid() — the
//      client never gets to choose the user_id.
//   2. Calls preflight_identity_verification(user_id) to enforce
//      already-verified, retry-limit, cooldown, and pending-reuse rules
//      server-side.
//   3. If a Persona inquiry must be created, POSTs to /api/v1/inquiries
//      with reference-id = auth.uid() so the Phase 2 webhook can map the
//      result back to the right Buddy user.
//   4. Records the inquiry via create_identity_verification_attempt(...)
//      so the row exists in identity_verifications and the profile cooldown
//      timer starts ticking.
//   5. Optionally fetches a session token from /resume so the Persona
//      mobile SDK can launch the inquiry without re-entering anything.
//
// Returned payload deliberately contains only what the SDK needs.
// PERSONA_API_KEY never leaves the function.
//
// Deploy:
//   supabase functions deploy create-persona-inquiry
//
// Required secrets (set via `supabase secrets set` or Dashboard):
//   - PERSONA_API_KEY            Persona server-side API key
//   - PERSONA_TEMPLATE_ID        e.g. itmpl_…
//   - PERSONA_ENVIRONMENT        "sandbox" | "production"  (informational only;
//                                   inquiry environment is determined by the
//                                   Persona API key + template, not this var)
//   - PERSONA_API_BASE           optional, defaults to https://api.withpersona.com
//   - PERSONA_API_VERSION        optional, defaults to 2023-01-05
//   - SUPABASE_URL               auto-injected at runtime
//   - SUPABASE_SERVICE_ROLE_KEY  auto-injected at runtime

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PERSONA_API_KEY = Deno.env.get("PERSONA_API_KEY") ?? "";
const PERSONA_TEMPLATE_ID = Deno.env.get("PERSONA_TEMPLATE_ID") ?? "";
const PERSONA_ENVIRONMENT = Deno.env.get("PERSONA_ENVIRONMENT") ?? "sandbox";
const PERSONA_API_BASE = Deno.env.get("PERSONA_API_BASE") ?? "https://api.withpersona.com";
const PERSONA_API_VERSION = Deno.env.get("PERSONA_API_VERSION") ?? "2023-01-05";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY ||
    !PERSONA_API_KEY ||
    !PERSONA_TEMPLATE_ID
  ) {
    console.error("create-persona-inquiry missing required env vars");
    return jsonResponse({ error: "server_misconfigured" }, 500);
  }

  // ── 1. Extract & verify the user's Supabase JWT ─────────────────────────
  const authHeader =
    req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    return jsonResponse({ error: "not_authenticated" }, 401);
  }
  const jwt = authHeader.slice(7).trim();

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user?.id) {
    return jsonResponse({ error: "not_authenticated" }, 401);
  }
  const userId = userData.user.id;

  // ── 2. Preflight via SECURITY DEFINER RPC ───────────────────────────────
  const { data: preflightRows, error: preflightErr } = await admin.rpc(
    "preflight_identity_verification",
    { p_user_id: userId },
  );

  if (preflightErr) {
    console.error("preflight_identity_verification failed:", preflightErr);
    return jsonResponse({ error: "preflight_failed" }, 500);
  }

  const preflight = Array.isArray(preflightRows) ? preflightRows[0] : preflightRows;
  if (!preflight || typeof preflight !== "object") {
    return jsonResponse({ error: "preflight_empty" }, 500);
  }

  const verdict = (preflight as { verdict?: string }).verdict ?? "";
  const retryCount = (preflight as { retry_count?: number }).retry_count ?? 0;
  const existingReferenceId =
    (preflight as { existing_reference_id?: string | null }).existing_reference_id ?? null;
  const cooldownRemaining =
    (preflight as { cooldown_seconds_remaining?: number }).cooldown_seconds_remaining ?? 0;

  if (verdict === "already_verified") {
    return jsonResponse({
      status: "already_verified",
      inquiry_id: null,
      reference_id: userId,
      session_token: null,
      reused: false,
      retry_count: 0,
    }, 200);
  }

  if (verdict === "retry_limit_reached") {
    return jsonResponse({
      error: "verification_retry_limit_reached",
      retry_count: retryCount,
    }, 429);
  }

  if (verdict === "cooldown") {
    return jsonResponse({
      error: "verification_cooldown",
      retry_after_seconds: cooldownRemaining,
    }, 429);
  }

  // ── 3. Either reuse the pending inquiry or create a new one ─────────────
  let inquiryId: string | null = null;
  let inquiryStatus = "pending";
  let reused = false;

  if (verdict === "reuse_pending") {
    if (!existingReferenceId) {
      console.error("reuse_pending verdict missing reference_id");
      return jsonResponse({ error: "preflight_inconsistent" }, 500);
    }
    inquiryId = existingReferenceId;
    inquiryStatus = "pending";
    reused = true;
  } else if (verdict === "create_new") {
    const created = await createPersonaInquiry(userId);
    if (!created.ok) {
      console.error("Persona inquiry creation failed:", created.errorBody);
      return jsonResponse({ error: "persona_inquiry_failed" }, 502);
    }
    inquiryId = created.inquiryId;
    inquiryStatus = created.status;

    const { error: recordErr } = await admin.rpc(
      "create_identity_verification_attempt",
      {
        p_user_id: userId,
        p_provider_reference_id: inquiryId,
        p_retry_count: retryCount,
      },
    );
    if (recordErr) {
      // Persona has accepted the inquiry; the webhook will still update state
      // when the user completes it. Log loudly but don't fail the launch.
      console.error("create_identity_verification_attempt failed:", recordErr);
    }
  } else {
    console.error("Unknown preflight verdict:", verdict);
    return jsonResponse({ error: "preflight_unknown_verdict" }, 500);
  }

  // ── 4. Fetch a one-time session token for SDK launch (best-effort) ──────
  const sessionToken = await fetchPersonaSessionToken(inquiryId);

  return jsonResponse({
    inquiry_id: inquiryId,
    reference_id: userId,
    status: inquiryStatus,
    session_token: sessionToken,
    reused,
    retry_count: retryCount,
  }, 200);
});

// ── Persona REST helpers ─────────────────────────────────────────────────────

interface CreatedInquiry {
  ok: true;
  inquiryId: string;
  status: string;
}

interface FailedInquiry {
  ok: false;
  errorBody: string;
}

async function createPersonaInquiry(
  userId: string,
): Promise<CreatedInquiry | FailedInquiry> {
  // Persona rejects any `fields.*` entry that is not declared on the inquiry
  // template's field schema with:
  //   fields '["user_id","environment","created_at"]' not defined on field schema
  // Phase 2 webhook attribution relies solely on reference-id, which is set
  // here from auth.uid() — so we do NOT need to send any custom fields. If
  // we ever want extra metadata, the right place is the inquiry template's
  // field schema in the Persona dashboard, not this payload.
  const requestBody = {
    data: {
      attributes: {
        "inquiry-template-id": PERSONA_TEMPLATE_ID,
        // reference-id is the canonical channel the Phase 2 webhook uses to
        // attribute results back to the Buddy user. Always auth.uid().
        "reference-id": userId,
      },
    },
  };

  const res = await fetch(`${PERSONA_API_BASE}/api/v1/inquiries`, {
    method: "POST",
    headers: personaHeaders(),
    body: JSON.stringify(requestBody),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error("Persona /inquiries non-2xx", {
      status: res.status,
      statusText: res.statusText,
      body: truncate(text, 2000),
      template_id_present: PERSONA_TEMPLATE_ID.length > 0,
      reference_id_present: userId.length > 0,
    });
    return { ok: false, errorBody: truncate(text, 2000) };
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, errorBody: "invalid_persona_response_json" };
  }

  const inquiryId = (body as {
    data?: { id?: unknown; attributes?: { status?: unknown } };
  }).data?.id;
  const status = (body as {
    data?: { attributes?: { status?: unknown } };
  }).data?.attributes?.status;

  if (typeof inquiryId !== "string" || inquiryId.length === 0) {
    return { ok: false, errorBody: "missing_inquiry_id_in_persona_response" };
  }

  return {
    ok: true,
    inquiryId,
    status: typeof status === "string" ? status : "created",
  };
}

// Best-effort: not every Persona template / API version returns a session
// token from /resume. We swallow errors so a missing token doesn't block the
// launch — the SDK can still resume by inquiry_id alone.
async function fetchPersonaSessionToken(inquiryId: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${PERSONA_API_BASE}/api/v1/inquiries/${encodeURIComponent(inquiryId)}/resume`,
      { method: "POST", headers: personaHeaders() },
    );
    if (!res.ok) return null;
    const body = await res.json();
    const token =
      (body as { meta?: { ["session-token"]?: unknown } }).meta?.["session-token"] ??
      (body as { data?: { meta?: { ["session-token"]?: unknown } } }).data?.meta?.["session-token"];
    return typeof token === "string" ? token : null;
  } catch (err) {
    console.warn("fetchPersonaSessionToken failed (non-fatal):", err);
    return null;
  }
}

function personaHeaders(): Record<string, string> {
  return {
    "authorization": `Bearer ${PERSONA_API_KEY}`,
    "persona-version": PERSONA_API_VERSION,
    "content-type": "application/json",
    "accept": "application/json",
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}
