export function SectionProblem() {
  return (
    <section id="problem" className="border-t border-mist/60 bg-paper">
      <div className="container-wide py-20 sm:py-28">
        <div className="grid gap-12 sm:grid-cols-12">
          <div className="sm:col-span-5">
            <p className="eyebrow mb-4">Problem</p>
            <h2 className="text-display-2 text-ink">
              Kleinigkeiten, die deinen Tag fressen.
            </h2>
          </div>

          <div className="sm:col-span-7">
            <p className="text-lg leading-relaxed text-ink/75">
              Möbel aufbauen, WLAN reparieren, kurz zum Bahnhof fahren, beim
              Umzug eine extra Hand — die kleinen Probleme häufen sich, aber
              es gibt keinen guten Ort, an dem man sie schnell und sicher
              loswird.
            </p>
            <p className="mt-4 text-lg leading-relaxed text-ink/75">
              Freundeskreis fragen ist umständlich. Plattformen sind teuer,
              langsam und anonym. Nachbarschafts-Apps sind voll mit
              gelöschten Beiträgen statt echter Hilfe.
            </p>
            <ul className="mt-8 space-y-3">
              <Pain>Stundenlanges Suchen statt erledigen lassen.</Pain>
              <Pain>Keine Klarheit über Preis und Verfügbarkeit.</Pain>
              <Pain>Kein Vertrauen — wer steht eigentlich vor meiner Tür?</Pain>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function Pain({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-ink/85">
      <span
        aria-hidden
        className="mt-2 inline-block h-1.5 w-1.5 flex-none rounded-full bg-flame"
      />
      <span className="text-base leading-7">{children}</span>
    </li>
  );
}
