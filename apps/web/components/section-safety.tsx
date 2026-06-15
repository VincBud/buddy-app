const PILLARS = [
  {
    title: "Identität verifiziert",
    body:
      "Jeder Buddy bestätigt seine Identität per Ausweis und Selfie über Persona — bevor irgendetwas anderes geht.",
  },
  {
    title: "Du wählst, wer kommt",
    body:
      "Erst wenn du eine Bewerbung annimmst, wird der Chat geöffnet. Vorher sieht niemand deine Adresse.",
  },
  {
    title: "Zwei-Wege-Bewertung",
    body:
      "Nach jedem Job bewerten sich beide Seiten. So bleibt das Netzwerk gesund und Trittbrettfahrer fallen früh auf.",
  },
  {
    title: "Klar gemeldet",
    body:
      "Ein-Tap-Meldung in jedem Chat. Verstöße werden umgehend von uns geprüft, mit Konsequenzen bis zum Plattformausschluss.",
  },
] as const;

export function SectionSafety() {
  return (
    <section id="safety" className="border-t border-mist/60 bg-paper">
      <div className="container-wide py-20 sm:py-28">
        <div className="grid gap-12 sm:grid-cols-12">
          <div className="sm:col-span-5">
            <p className="eyebrow mb-4">Sicherheit & Vertrauen</p>
            <h2 className="text-display-2 text-ink">
              Wer dir hilft, ist kein Zufall.
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-ink/70">
              Lokale Hilfe funktioniert nur mit Vertrauen. Deshalb sind
              Identitäts-Verifizierung, Auswahl und beidseitige Bewertung bei
              Buddy keine optionalen Extras — sondern die Basis jeder
              Nachbarschafts-Hilfe.
            </p>
          </div>

          <ul className="grid gap-4 sm:col-span-7 sm:grid-cols-2">
            {PILLARS.map((p) => (
              <li
                key={p.title}
                className="rounded-xl2 border border-mist bg-paper p-6 shadow-soft transition hover:shadow-card"
              >
                <h3 className="text-base font-bold text-ink">{p.title}</h3>
                <p className="mt-2 text-sm leading-6 text-ink/70">{p.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
