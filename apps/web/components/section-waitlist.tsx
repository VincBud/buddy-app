"use client";

import { useState, type FormEvent } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// Role values MUST match the production CHECK constraint on
// public.landing_waitlist (landing_waitlist_role_check). Any value not
// listed below will be rejected by Supabase on insert.
type Role = "job_creator" | "buddy" | "both" | "partner" | "investor" | "other";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; alreadyRegistered: boolean }
  | { kind: "error"; message: string };

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "job_creator", label: "Ich brauche Hilfe" },
  { value: "buddy",       label: "Ich möchte als Buddy helfen" },
  { value: "both",        label: "Beides" },
  { value: "partner",     label: "Partner / Kooperation" },
  { value: "investor",    label: "Investor / Presse / Netzwerk" },
  { value: "other",       label: "Sonstiges" },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SectionWaitlist() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [city, setCity] = useState("");
  const [role, setRole] = useState<Role | "">("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const isSubmitting = status.kind === "submitting";
  const isSuccess = status.kind === "success";

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSubmitting) return;

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedCity = city.trim();
    const trimmedMessage = message.trim();

    if (!trimmedName || !trimmedEmail) {
      setStatus({ kind: "error", message: "Bitte gib Name und E-Mail an." });
      return;
    }
    if (!EMAIL_RE.test(trimmedEmail)) {
      setStatus({ kind: "error", message: "Bitte eine gültige E-Mail-Adresse eingeben." });
      return;
    }

    setStatus({ kind: "submitting" });

    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.from("landing_waitlist").insert({
        name: trimmedName,
        email: trimmedEmail,
        city: trimmedCity || null,
        role: role || null,
        message: trimmedMessage || null,
        source: "landing_page",
      });

      if (error) {
        if (isDuplicateEmailError(error)) {
          if (process.env.NODE_ENV !== "production") {
            console.warn("[waitlist] duplicate email — showing already-registered state");
          }
          // Friendly "you're already in" success state instead of an error.
          setStatus({ kind: "success", alreadyRegistered: true });
          setName("");
          setEmail("");
          setCity("");
          setRole("");
          setMessage("");
          return;
        }
        if (process.env.NODE_ENV !== "production") {
          console.error("[waitlist] insert failed:", error);
        }
        setStatus({
          kind: "error",
          message:
            "Wir konnten dich gerade nicht eintragen. Bitte versuche es in einem Moment erneut.",
        });
        return;
      }

      setStatus({ kind: "success", alreadyRegistered: false });
      setName("");
      setEmail("");
      setCity("");
      setRole("");
      setMessage("");
    } catch (err) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[waitlist] unexpected error:", err);
      }
      setStatus({
        kind: "error",
        message:
          "Es ist ein unerwarteter Fehler aufgetreten. Bitte lade die Seite neu und versuche es noch einmal.",
      });
    }
  };

  return (
    <section id="waitlist" className="border-t border-mist/60 bg-paper">
      <div className="container-wide py-20 sm:py-28">
        <div className="grid gap-12 sm:grid-cols-12">
          <div className="sm:col-span-5">
            <p className="eyebrow mb-4">Warteliste</p>
            <h2 className="text-display-2 text-ink">
              Sei beim Early Access dabei.
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-ink/70">
              Wir starten bewusst klein mit dem Rosenheim-Test und öffnen erst
              danach schrittweise weiter in Deutschland. Trage dich ein, wir
              melden uns, sobald deine Region und deine Rolle dran sind — kein
              Spam, ein Hinweis pro Phase.
            </p>
          </div>

          <div className="sm:col-span-7">
            {status.kind === "success" ? (
              <SuccessCard
                alreadyRegistered={status.alreadyRegistered}
                onReset={() => setStatus({ kind: "idle" })}
              />
            ) : (
              <form
                onSubmit={onSubmit}
                noValidate
                className="rounded-xl2 border border-mist bg-paper p-6 shadow-card sm:p-8"
              >
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Name" required>
                    <input
                      type="text"
                      autoComplete="name"
                      required
                      maxLength={120}
                      disabled={isSubmitting}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className={inputClass}
                      placeholder="Vor- und Nachname"
                    />
                  </Field>
                  <Field label="E-Mail" required>
                    <input
                      type="email"
                      autoComplete="email"
                      inputMode="email"
                      required
                      maxLength={254}
                      disabled={isSubmitting}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className={inputClass}
                      placeholder="deine@email.de"
                    />
                  </Field>
                  <Field label="Stadt">
                    <input
                      type="text"
                      autoComplete="address-level2"
                      maxLength={120}
                      disabled={isSubmitting}
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className={inputClass}
                      placeholder="z. B. Berlin"
                    />
                  </Field>
                  <Field label="Rolle">
                    <select
                      disabled={isSubmitting}
                      value={role}
                      onChange={(e) => setRole(e.target.value as Role | "")}
                      className={`${inputClass} appearance-none pr-10`}
                    >
                      <option value="">Bitte wählen</option>
                      {ROLE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </Field>
                </div>

                <Field label="Nachricht (optional)" className="mt-5">
                  <textarea
                    disabled={isSubmitting}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={4}
                    maxLength={2000}
                    className={`${inputClass} min-h-[7rem] resize-y`}
                    placeholder="Was machst du, wie können wir helfen, was würdest du dir wünschen?"
                  />
                </Field>

                {status.kind === "error" && (
                  <p role="alert" className="mt-4 rounded-lg border border-flame/40 bg-flame/[0.06] px-4 py-3 text-sm text-flame">
                    {status.message}
                  </p>
                )}

                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs leading-5 text-smoke">
                    Mit dem Eintragen stimmst du zu, dass wir dich kontaktieren dürfen.
                    Details in der{" "}
                    <a className="underline decoration-mist underline-offset-2 hover:text-ink" href="/datenschutz">
                      Datenschutzerklärung
                    </a>.
                  </p>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    aria-busy={isSubmitting}
                    className="inline-flex h-12 items-center justify-center rounded-full bg-flame px-6 text-base font-semibold text-paper shadow-flame transition hover:translate-y-[-1px] hover:bg-[#FF5520] disabled:cursor-not-allowed disabled:bg-flame/50 disabled:shadow-none disabled:hover:translate-y-0"
                  >
                    {isSubmitting ? "Wird gesendet…" : "Auf die Warteliste"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

const inputClass =
  "w-full rounded-lg border border-mist bg-paper px-4 py-3 text-base text-ink shadow-sm transition placeholder:text-smoke focus:border-purple focus:outline-none focus:ring-2 focus:ring-purple/30 disabled:cursor-not-allowed disabled:opacity-60";

// Detect a Supabase / PostgREST unique-constraint violation when the same
// email is already on the waitlist. Postgres surfaces this as SQLSTATE
// 23505; PostgREST forwards the code verbatim on the error envelope. We
// also fall back to a message/details substring match so future schema
// changes (different constraint names, error wrapping in newer supabase-js
// versions) keep being handled gracefully without us claiming a server
// failure to the user.
const DUPLICATE_HINTS = [
  "duplicate key",
  "already exists",
  "unique constraint",
  "landing_waitlist_email",
];

const isDuplicateEmailError = (error: {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}): boolean => {
  if (error.code === "23505") return true;
  const haystack = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  return DUPLICATE_HINTS.some((h) => haystack.includes(h));
};

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-smoke">
        {label}
        {required && <span aria-hidden className="ml-1 text-flame">*</span>}
      </span>
      {children}
    </label>
  );
}

function SuccessCard({
  alreadyRegistered,
  onReset,
}: {
  alreadyRegistered: boolean;
  onReset: () => void;
}) {
  return (
    <div
      role="status"
      className="flex flex-col items-start gap-4 rounded-xl2 border border-purple/30 bg-purple/[0.06] p-8 shadow-card"
    >
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-purple text-paper">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
      <h3 className="text-xl font-bold text-ink">
        {alreadyRegistered
          ? "Du bist bereits auf der Warteliste."
          : "Du bist auf der Warteliste."}
      </h3>
      <p className="text-base leading-7 text-ink/70">
        {alreadyRegistered
          ? "Wir melden uns, sobald du dran bist."
          : "Wir melden uns, sobald deine Region und Rolle für den Early Access dran sind. Bis dahin: erzähl Buddy weiter, wenn du jemanden kennst, der davon profitieren würde."}
      </p>
      <button
        type="button"
        onClick={onReset}
        className="text-sm font-semibold text-purple hover:underline"
      >
        Noch jemanden eintragen →
      </button>
    </div>
  );
}
