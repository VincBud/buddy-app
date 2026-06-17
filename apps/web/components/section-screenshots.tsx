import fs from "node:fs";
import path from "node:path";

// ── Where to drop the real assets ───────────────────────────────────────────
//
//   apps/web/public/screenshots/01-problem-posten.{svg,png}
//   apps/web/public/screenshots/02-buddy-auswaehlen.{svg,png}
//   apps/web/public/screenshots/03-chat-oeffnen.{svg,png}
//   apps/web/public/screenshots/04-auftrag-abschliessen.{svg,png}
//
// We ship hand-crafted SVG mockups today (brand-consistent, vector-sharp,
// ~5 KB each). The resolver prefers .svg, falling back to .png so a future
// rasterised export from a real device can drop in with the same basename
// and automatically take over on the next build.
//
// Files must contain DEMO DATA only — no real names, e-mails, addresses,
// phone numbers, chat content, Supabase IDs, payment details or debug
// overlays.

type Slide = {
  n: string;            // "01" .. "04"
  caption: string;      // visible label under the phone
  alt: string;          // alt text once the real image is in place
  base: string;         // file basename (without extension) under /public/screenshots/
};

const SLIDES: readonly Slide[] = [
  {
    n: "01",
    caption: "Problem posten",
    alt: "Buddy App — Bildschirm zum Erstellen eines neuen Hilfe-Auftrags mit Preis und Radius (Demo-Daten).",
    base: "01-problem-posten",
  },
  {
    n: "02",
    caption: "Buddy auswählen",
    alt: "Buddy App — Übersicht eingehender Bewerbungen mit Profil, Bewertungen und Preis zur Auswahl eines Buddys (Demo-Daten).",
    base: "02-buddy-auswaehlen",
  },
  {
    n: "03",
    caption: "Chat öffnen",
    alt: "Buddy App — Direkter Chat zwischen Auftraggeber:in und ausgewähltem Buddy nach erfolgter Annahme (Demo-Daten).",
    base: "03-chat-oeffnen",
  },
  {
    n: "04",
    caption: "Auftrag abschließen",
    alt: "Buddy App — Beidseitige Bestätigung und gegenseitige Bewertung nach abgeschlossenem Auftrag (Demo-Daten).",
    base: "04-auftrag-abschliessen",
  },
] as const;

// Resolve the asset extension ONCE at server-render time (build-time for
// static prerender) so we never serve a broken `<img>` and we never need
// `next/image` SVG flags. Returns the public path or null when neither
// extension exists, in which case the card falls back to a styled
// placeholder.
const SCREENSHOTS_DIR = path.join(process.cwd(), "public", "screenshots");
const RESOLVE_ORDER = [".svg", ".png"] as const;

const resolveAssetPath = (base: string): string | null => {
  for (const ext of RESOLVE_ORDER) {
    try {
      if (fs.existsSync(path.join(SCREENSHOTS_DIR, `${base}${ext}`))) {
        return `/screenshots/${base}${ext}`;
      }
    } catch {
      /* fall through */
    }
  }
  return null;
};

export function SectionScreenshots() {
  return (
    <section
      id="screenshots"
      aria-labelledby="screenshots-heading"
      className="border-t border-mist/60 bg-paper"
    >
      <div className="container-wide py-20 sm:py-28">
        <div className="max-w-3xl">
          <p className="eyebrow mb-4">Produktstand</p>
          <h2 id="screenshots-heading" className="text-display-2 text-ink">
            Ein erster Blick in den Buddy MVP.
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-ink/70">
            Der MVP wurde end-to-end getestet. Die folgenden Screens zeigen
            beispielhafte Ansichten aus dem aktuellen Produktstand vor dem
            Rosenheim-Test.
          </p>
        </div>

        <ul className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {SLIDES.map((slide) => (
            <ScreenshotCard key={slide.n} slide={slide} />
          ))}
        </ul>

        <p className="mt-10 text-xs text-smoke">
          Hinweis: Alle dargestellten Inhalte sind Demo-Daten. Es werden keine
          realen Personen, Nachrichten oder Auftragsdaten gezeigt.
        </p>
      </div>
    </section>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────

function ScreenshotCard({ slide }: { slide: Slide }) {
  const assetPath = resolveAssetPath(slide.base);

  return (
    <li className="group flex flex-col">
      {/* Phone frame */}
      <div className="relative mx-auto w-full max-w-[280px]">
        <div className="relative overflow-hidden rounded-[2rem] border border-mist bg-gradient-to-b from-ink/[0.04] to-ink/[0.10] shadow-card transition group-hover:shadow-flame">
          {/* Aspect-ratio shell roughly matching iPhone portrait */}
          <div className="relative w-full" style={{ paddingTop: `${(2532 / 1170) * 100}%` }}>
            {assetPath ? (
              // Plain <img>: our SVG mockups are first-party, optimisation
              // would add nothing measurable, and next/image's SVG handling
              // is opt-in via dangerouslyAllowSVG which we want to avoid.
              <img
                src={assetPath}
                alt={slide.alt}
                loading={slide.n === "01" ? "eager" : "lazy"}
                decoding="async"
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <PhonePlaceholder n={slide.n} caption={slide.caption} />
            )}

            {/* Subtle inner bezel + status-bar notch hint */}
            <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[2rem] ring-1 ring-inset ring-ink/5" />
            <div
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-2 h-1.5 w-20 -translate-x-1/2 rounded-full bg-ink/15"
            />
          </div>
        </div>
      </div>

      {/* Caption */}
      <div className="mt-5 text-center">
        <span className="text-xs font-semibold tracking-[0.14em] text-flame">
          {slide.n}
        </span>
        <h3 className="mt-1 text-base font-bold text-ink">{slide.caption}</h3>
      </div>
    </li>
  );
}

function PhonePlaceholder({ n, caption }: { n: string; caption: string }) {
  return (
    <div
      aria-hidden
      className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-purple/10 via-paper to-flame/10"
    >
      <span className="select-none text-[7rem] font-extrabold leading-none text-purple/15">
        {n}
      </span>
      <span className="mt-3 px-4 text-center text-sm font-semibold text-ink/55">
        {caption}
      </span>
      <span className="mt-1 text-[10px] uppercase tracking-[0.18em] text-smoke/70">
        Screenshot folgt
      </span>
    </div>
  );
}
