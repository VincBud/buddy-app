// persona-webhook
//
// Supabase Edge Function that receives Persona identity-verification webhook
// events, verifies their HMAC-SHA256 signature, stores them idempotently in
// public.identity_verification_webhooks, and applies state changes via the
// SECURITY DEFINER RPC public.process_persona_webhook.
//
// Deploy:
//   supabase functions deploy persona-webhook
//
// Required secrets (set via `supabase secrets set` or Dashboard):
//   - PERSONA_WEBHOOK_SECRET    Persona webhook signing secret
//   - SUPABASE_URL              auto-injected at runtime
//   - SUPABASE_SERVICE_ROLE_KEY auto-injected at runtime
//
// JWT verification is disabled for this function in supabase/config.toml —
// Persona signs requests itself; we authenticate them with HMAC instead.

import { createClient } from "@supabase/supabase-js";

// Read all secrets via Deno.env.get(...)?.trim() so a stray newline from
// `supabase secrets set` can never silently corrupt the JWT and demote us
// to anon at PostgREST.
const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "";
const PERSONA_WEBHOOK_SECRET = Deno.env.get("PERSONA_WEBHOOK_SECRET")?.trim() ?? "";

// Boot-time diagnostics. Logged ONCE per cold start. We never log the values
// themselves — only presence/length — so it is safe to leave on while we
// confirm the runtime is wired up correctly. Remove once stable.
console.log("persona-webhook boot diagnostics", {
  has_supabase_url: supabaseUrl.length > 0,
  has_service_role_key: serviceRoleKey.length > 0,
  service_role_key_length: serviceRoleKey.length,
  has_webhook_secret: PERSONA_WEBHOOK_SECRET.length > 0,
});

// Build the service-role client ONCE at module scope so every write below
// uses the exact same configuration. supabase-js can pick up stray
// Authorization headers from the request context in some Edge runtime
// versions; pinning both Authorization and apikey via global.headers — and
// never forwarding any header from the incoming Persona request — guarantees
// the PostgREST role stays `service_role` for every read/write to
// identity_verification_webhooks. RLS/GRANTs on the table are unchanged.
const supabaseServiceRole = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
    },
  },
});

// Persona inquiry lifecycle events we actually act on. Other events are still
// stored (for audit) but do not trigger profile updates.
const RELEVANT_EVENTS = new Set<string>([
  "inquiry.created",
  "inquiry.started",
  "inquiry.pending",
  "inquiry.completed",
  "inquiry.approved",
  "inquiry.declined",
  "inquiry.failed",
  "inquiry.expired",
  "inquiry.marked-for-review",
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  if (!PERSONA_WEBHOOK_SECRET || !supabaseUrl || !serviceRoleKey) {
    console.error("persona-webhook missing required env vars", {
      has_supabase_url: supabaseUrl.length > 0,
      has_service_role_key: serviceRoleKey.length > 0,
      has_webhook_secret: PERSONA_WEBHOOK_SECRET.length > 0,
    });
    return jsonResponse({ error: "server_misconfigured" }, 500);
  }

  const signatureHeader =
    req.headers.get("persona-signature") ?? req.headers.get("Persona-Signature");
  if (!signatureHeader) {
    return jsonResponse({ error: "missing_signature" }, 400);
  }

  // Read body as raw text so the HMAC matches Persona's signed payload byte-
  // for-byte. Do NOT JSON.parse → stringify; whitespace differences will fail
  // verification.
  const rawBody = await req.text();

  const signatureValid = await verifyPersonaSignature(
    rawBody,
    signatureHeader,
    PERSONA_WEBHOOK_SECRET,
  );
  if (!signatureValid) {
    return jsonResponse({ error: "invalid_signature" }, 401);
  }

  let event: PersonaEvent;
  try {
    event = JSON.parse(rawBody) as PersonaEvent;
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const eventData = event?.data;
  const webhookId = eventData?.id;
  const eventType = eventData?.attributes?.name;
  if (!webhookId || !eventType) {
    return jsonResponse({ error: "invalid_payload" }, 400);
  }

  const inquiry = eventData?.attributes?.payload?.data;
  const inquiryId: string | null = inquiry?.id ?? null;
  const inquiryAttrs = (inquiry?.attributes ?? {}) as Record<string, unknown>;
  const personaStatus = typeof inquiryAttrs.status === "string"
    ? (inquiryAttrs.status as string)
    : null;
  const rejectionReason = pickRejectionReason(inquiryAttrs);
  const completed = typeof inquiryAttrs["completed-at"] === "string"
    && (inquiryAttrs["completed-at"] as string).length > 0;
  const userId = resolveBuddyUserId(inquiryAttrs);

  // Use the module-level service-role client. We do NOT construct a per-
  // request client and we never forward the incoming request's Authorization
  // header (Persona only sends Persona-Signature anyway), so the PostgREST
  // role is guaranteed to be `service_role` for every write below.
  const supabase = supabaseServiceRole;

  // ── 1. Idempotently store the raw event ────────────────────────────────────
  // UNIQUE(webhook_id) on identity_verification_webhooks gives us atomic
  // dedup. We use upsert+ignoreDuplicates so duplicate retries don't error;
  // we then look up the existing row's processed flag below to decide whether
  // to re-attempt processing.
  console.log("persona-webhook upsert", {
    table: "identity_verification_webhooks",
    client: "service_role",
    service_role_key_length: serviceRoleKey.length,
    webhook_id: webhookId,
  });
  const { error: upsertErr } = await supabase
    .from("identity_verification_webhooks")
    .upsert(
      {
        webhook_id: webhookId,
        provider: "persona",
        event_type: eventType,
        user_id: userId,
        provider_reference_id: inquiryId,
        payload: event,
        processed: false,
      },
      { onConflict: "webhook_id", ignoreDuplicates: true },
    );

  if (upsertErr) {
    console.error("Failed to store Persona webhook:", upsertErr);
    return jsonResponse({ error: "storage_error" }, 500);
  }

  // Fetch current row state — we may have just inserted it, or it may already
  // exist from a previous delivery attempt.
  const { data: existing, error: fetchErr } = await supabase
    .from("identity_verification_webhooks")
    .select("id, processed")
    .eq("webhook_id", webhookId)
    .maybeSingle();

  if (fetchErr || !existing) {
    console.error("Failed to read stored webhook after upsert:", fetchErr);
    return jsonResponse({ error: "storage_error" }, 500);
  }

  if (existing.processed) {
    // Idempotent replay — nothing more to do, but acknowledge so Persona
    // stops retrying.
    return jsonResponse({ ok: true, duplicate: true }, 200);
  }

  // ── 2. Ignored events: persist for audit, mark processed, exit ─────────────
  if (!RELEVANT_EVENTS.has(eventType)) {
    await markProcessed(supabase, webhookId);
    return jsonResponse({ ok: true, ignored: true }, 200);
  }

  // ── 3. If we have no user, store for later reconciliation and exit ────────
  if (!userId) {
    await supabase
      .from("identity_verification_webhooks")
      .update({ error_message: "no_user_id_resolvable" })
      .eq("webhook_id", webhookId);
    // Acknowledge — re-delivery from Persona won't help us recover.
    return jsonResponse({ ok: true, unresolved_user: true }, 200);
  }

  // ── 4. Apply state via SECURITY DEFINER RPC ───────────────────────────────
  const { error: rpcErr } = await supabase.rpc("process_persona_webhook", {
    p_webhook_id: webhookId,
    p_user_id: userId,
    p_event_type: eventType,
    p_provider_reference_id: inquiryId,
    p_persona_status: personaStatus,
    p_rejection_reason: rejectionReason,
    p_completed: completed,
  });

  if (rpcErr) {
    console.error("process_persona_webhook RPC failed:", rpcErr);
    await supabase
      .from("identity_verification_webhooks")
      .update({
        processed: false,
        error_message: truncate(rpcErr.message ?? "rpc_failed", 500),
      })
      .eq("webhook_id", webhookId);
    // Return 5xx so Persona retries the delivery.
    return jsonResponse({ error: "processing_failed" }, 500);
  }

  // ── 5. Mark webhook processed only after successful state apply ───────────
  await markProcessed(supabase, webhookId);

  return jsonResponse({ ok: true }, 200);
});

// ── Helpers ──────────────────────────────────────────────────────────────────

type SupabaseClient = ReturnType<typeof createClient>;

interface PersonaEvent {
  data?: {
    id?: string;
    type?: string;
    attributes?: {
      name?: string;
      payload?: { data?: { id?: string; attributes?: Record<string, unknown> } };
      "created-at"?: string;
    };
  };
}

async function markProcessed(supabase: SupabaseClient, webhookId: string) {
  const { error } = await supabase
    .from("identity_verification_webhooks")
    .update({
      processed: true,
      processed_at: new Date().toISOString(),
      error_message: null,
    })
    .eq("webhook_id", webhookId);
  if (error) console.error("Failed to mark webhook processed:", error);
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Resolve the Buddy auth user_id from Persona inquiry attributes. Preference
// order:
//   1. inquiry.attributes.reference-id  (canonical; set when the app starts
//      the inquiry with the authenticated user_id as reference_id)
//   2. inquiry.attributes.fields["user-id"|"user_id"|"buddy-user-id"|"buddy_user_id"].value
//
// We only accept values that look like UUIDs to avoid mis-attributing webhooks
// to the wrong user from malformed metadata.
function resolveBuddyUserId(attrs: Record<string, unknown>): string | null {
  const refId = attrs["reference-id"];
  if (typeof refId === "string" && UUID_RE.test(refId)) return refId.toLowerCase();

  const fields = attrs.fields;
  if (fields && typeof fields === "object") {
    const fieldMap = fields as Record<string, unknown>;
    const candidates = ["user-id", "user_id", "buddy-user-id", "buddy_user_id"];
    for (const key of candidates) {
      const node = fieldMap[key];
      const value = typeof node === "string"
        ? node
        : (node as { value?: unknown } | undefined)?.value;
      if (typeof value === "string" && UUID_RE.test(value)) {
        return value.toLowerCase();
      }
    }
  }
  return null;
}

function pickRejectionReason(attrs: Record<string, unknown>): string | null {
  const candidates = [
    "decline-reason",
    "rejection-reason",
    "failure-reason",
    "review-reason",
  ];
  for (const key of candidates) {
    const v = attrs[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

// Verify Persona webhook signature. Persona sends:
//   Persona-Signature: t=<unix_timestamp>,v1=<hmac_sha256_hex>[,v1=<rotation>]
// The signed payload is `${timestamp}.${rawBody}`. Multiple v1 entries can
// appear during signing-secret rotation; we accept the request if any one
// matches our current secret.
async function verifyPersonaSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
): Promise<boolean> {
  let timestamp = "";
  const signatures: string[] = [];
  for (const part of signatureHeader.split(",")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1);
    if (key === "t") timestamp = value;
    else if (key === "v1") signatures.push(value);
  }
  if (!timestamp || signatures.length === 0) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${timestamp}.${rawBody}`),
  );
  const expected = bufToHex(sigBuf);

  // Constant-time check across all candidate signatures.
  let matched = false;
  for (const candidate of signatures) {
    if (constantTimeEqual(candidate.toLowerCase(), expected)) matched = true;
  }
  return matched;
}

function bufToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}
