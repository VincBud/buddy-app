const STEPS = [
  {
    n: "01",
    title: "Problem posten",
    body:
      "Beschreibe in wenigen Sätzen, was du brauchst. Lege Budget und Radius fest. Fertig in unter einer Minute.",
  },
  {
    n: "02",
    title: "Buddies bewerben sich",
    body:
      "Verifizierte Nachbarn in deinem Radius sehen dein Problem und melden sich — meist in Minuten.",
  },
  {
    n: "03",
    title: "Du wählst",
    body:
      "Profil, Bewertungen, Preis: Du entscheidest, mit wem du arbeitest. Niemand bekommt deine Daten ohne Auswahl.",
  },
  {
    n: "04",
    title: "Chat & Done",
    body:
      "Sobald du gewählt hast, öffnet sich der direkte Chat. Treffpunkt klären, Job erledigen, beidseitig bestätigen.",
  },
] as const;

export function SectionHowItWorks() {
  return (
    <section id="how-it-works" className="bg-ink text-paper">
      <div className="container-wide py-20 sm:py-28">
        <div className="max-w-3xl">
          <p className="eyebrow mb-4 border-paper/15 bg-transparent text-paper/70">
            So funktioniert&apos;s
          </p>
          <h2 className="text-display-2 text-paper">
            Vier Schritte zwischen Problem und Lösung.
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-paper/70">
            Buddy ist ein Marktplatz, kein Verzeichnis. Du sagst was du brauchst,
            die Buddies kommen zu dir — nicht umgekehrt.
          </p>
        </div>

        <ol className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step) => (
            <li
              key={step.n}
              className="group relative rounded-xl2 border border-paper/10 bg-paper/[0.04] p-6 transition hover:border-paper/25 hover:bg-paper/[0.06]"
            >
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold tracking-widest text-flame">
                  {step.n}
                </span>
                <span className="h-px flex-1 bg-paper/15" />
              </div>
              <h3 className="mt-4 text-xl font-bold text-paper">{step.title}</h3>
              <p className="mt-2 text-sm leading-6 text-paper/70">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
