// FAQ section + matching FAQPage JSON-LD. The visible answers and the
// structured-data answers are generated from the SAME array, so Google's
// rich-results validator and the rendered HTML can never drift apart.

export const FAQ_ITEMS = [
  {
    q: "Was ist Buddy?",
    a: "Buddy ist eine hyperlokale Hilfe-App: ein Marktplatz für Alltagsprobleme. Du beschreibst dein Problem, legst Preis und Radius fest, und verifizierte Buddies aus deiner Nachbarschaft melden sich.",
  },
  {
    q: "Für wen ist Buddy gedacht?",
    a: "Für alle, die spontan Unterstützung in der Nähe brauchen — bei Erledigungen, Transporten, kleinen Problemen im Haushalt oder Aufgaben, für die gerade niemand Zeit hat — und für Menschen, die im eigenen Viertel gegen ein faires Honorar helfen möchten.",
  },
  {
    q: "Wie funktioniert Buddy?",
    a: "Problem posten, Preis festlegen, Bewerbungen erhalten, Helfer auswählen, im Chat klären, Auftrag erledigen, beidseitig bestätigen und bewerten.",
  },
  {
    q: "Ist Buddy schon verfügbar?",
    a: "MVP getestet, erste Testphase in Rosenheim, Early Access in Vorbereitung. Wir starten bewusst klein mit dem Rosenheim-Test und öffnen erst danach schrittweise weiter in Deutschland. Trage dich auf die Warteliste ein, wir melden uns, sobald du dran bist.",
  },
  {
    q: "Warum setzt Buddy auf Verifizierung?",
    a: "Damit du weißt, wer dir hilft. Jeder Buddy bestätigt seine Identität per Ausweis und Selfie, bevor er Aufträge annehmen kann. Bewertungen und Meldungen halten das Netzwerk gesund.",
  },
] as const;

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ_ITEMS.map((item) => ({
    "@type": "Question",
    name: item.q,
    acceptedAnswer: {
      "@type": "Answer",
      text: item.a,
    },
  })),
};

export function SectionFaq() {
  return (
    <section
      id="faq"
      aria-labelledby="faq-heading"
      className="border-t border-mist/60 bg-paper"
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      <div className="container-narrow py-20 sm:py-28">
        <div className="max-w-3xl">
          <p className="eyebrow mb-4">Häufige Fragen</p>
          <h2 id="faq-heading" className="text-display-2 text-ink">
            Buddy in fünf Antworten.
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-ink/70">
            Kurz, ehrlich, ohne Marketing-Sprech.
          </p>
        </div>

        <dl className="mt-12 divide-y divide-mist border-y border-mist">
          {FAQ_ITEMS.map((item) => (
            <details
              key={item.q}
              className="group py-5 sm:py-6"
            >
              <summary className="flex cursor-pointer list-none items-start justify-between gap-6 text-left">
                <dt className="text-base font-bold text-ink sm:text-lg">
                  {item.q}
                </dt>
                <span
                  aria-hidden
                  className="mt-1 inline-flex h-7 w-7 flex-none items-center justify-center rounded-full border border-mist text-smoke transition group-open:rotate-45 group-open:border-ink group-open:text-ink"
                >
                  +
                </span>
              </summary>
              <dd className="mt-3 max-w-3xl text-base leading-7 text-ink/75">
                {item.a}
              </dd>
            </details>
          ))}
        </dl>
      </div>
    </section>
  );
}
