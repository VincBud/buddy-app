export function SectionHero() {
  return (
    <section className="relative overflow-hidden bg-hero-radial">
      <div className="container-wide pb-20 pt-16 sm:pb-28 sm:pt-24">
        <p className="eyebrow mb-6">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-flame" />
          MVP getestet · Rosenheim-Test in Vorbereitung · Early Access folgt
        </p>

        <h1 className="max-w-4xl text-display-1 text-ink">
          Hilfe in Minuten.
          <br />
          <span className="text-purple">Aus deiner Nachbarschaft.</span>
        </h1>

        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink/70 sm:text-xl">
          Buddy ist die lokale Hilfe-App für Alltagsprobleme: Problem posten,
          Preis festlegen, Radius wählen — und ein verifizierter Buddy aus
          deiner Nachbarschaft meldet sich.
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-3">
          <a
            href="#waitlist"
            aria-label="Auf die Buddy-Warteliste eintragen"
            className="inline-flex h-12 items-center rounded-full bg-flame px-6 text-base font-semibold text-paper shadow-flame transition hover:translate-y-[-1px] hover:bg-[#FF5520]"
          >
            Auf die Warteliste
            <span aria-hidden className="ml-2">→</span>
          </a>
          <a
            href="#how-it-works"
            aria-label="So funktioniert die Buddy Hilfe-App"
            className="inline-flex h-12 items-center rounded-full border border-mist bg-paper px-6 text-base font-semibold text-ink transition hover:border-ink/30"
          >
            So funktioniert&apos;s
          </a>
        </div>

        <dl className="mt-14 grid max-w-2xl grid-cols-2 gap-y-5 sm:grid-cols-3 sm:gap-x-10">
          <Stat label="Problem posten" value="< 60 s" />
          <Stat label="Erste Bewerbung" value="Minuten" />
          <Stat label="Helfer:innen" value="Verifiziert" />
        </dl>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-smoke">
        {label}
      </dt>
      <dd className="mt-1 text-xl font-bold text-ink">{value}</dd>
    </div>
  );
}
