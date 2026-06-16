const ITEMS = [
  {
    phase: "Phase 1",
    title: "MVP",
    state: "done",
    text:
      "Kern­flow getestet: Problem posten, Helfer bewerben sich, du wählst, Chat, Bewertung.",
  },
  {
    phase: "Phase 2",
    title: "Rosenheim-Test",
    state: "active",
    text:
      "Erste Testphase in Rosenheim in Vorbereitung — Verifizierung, Support und Operations werden für den Start vor Ort vorbereitet.",
  },
  {
    phase: "Phase 3",
    title: "Deutschland Early Access",
    state: "next",
    text:
      "Early Access in Vorbereitung — sobald die Rosenheim-Testphase ausgewertet ist, öffnen wir Wartelisten-Plätze schrittweise nach Region und Rolle.",
  },
] as const;

export function SectionMvpStatus() {
  return (
    <section id="status" className="border-t border-mist/60 bg-paper">
      <div className="container-wide py-20 sm:py-28">
        <div className="max-w-3xl">
          <p className="eyebrow mb-4">Aktueller Stand</p>
          <h2 className="text-display-2 text-ink">
            MVP getestet, erste Testphase in Rosenheim, Early Access in Vorbereitung.
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-ink/70">
            Wir bauen Buddy aktuell mit einer kleinen Gruppe aus der Praxis
            heraus. Als nächsten Schritt steht der Rosenheim-Test an. Was wir
            {" "}<em>nicht</em>{" "}tun: blind skalieren oder einen
            App-Store-Launch versprechen. Was wir tun: jeden Job verstehen,
            jeden Bug fixen, jede Wartelisten-Anmeldung lesen.
          </p>
        </div>

        <ol className="mt-12 grid gap-4 sm:grid-cols-3">
          {ITEMS.map((item) => (
            <li key={item.phase} className="rounded-xl2 border border-mist bg-paper p-6 shadow-soft">
              <div className="flex items-center gap-3">
                <StatusDot state={item.state} />
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-smoke">
                  {item.phase}
                </span>
              </div>
              <h3 className="mt-4 text-xl font-bold text-ink">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-ink/70">{item.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function StatusDot({ state }: { state: "done" | "active" | "next" }) {
  const map: Record<typeof state, { color: string; label: string }> = {
    done:   { color: "bg-purple", label: "abgeschlossen" },
    active: { color: "bg-flame animate-pulse", label: "in Arbeit" },
    next:   { color: "bg-mist", label: "geplant" },
  };
  const { color, label } = map[state];
  return (
    <span className={`inline-block h-2 w-2 rounded-full ${color}`} aria-label={label} />
  );
}
