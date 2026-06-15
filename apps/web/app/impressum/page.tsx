import Link from "next/link";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Impressum",
  description: "Anbieterkennzeichnung gemäß § 5 TMG für die Buddy-Landingpage.",
  robots: { index: false, follow: true },
};

export default function ImpressumPage() {
  return (
    <>
      <SiteHeader />
      <main className="container-narrow py-16 sm:py-24">
        <p className="eyebrow mb-4">Rechtliches</p>
        <h1 className="text-display-2 mb-8">Impressum</h1>

        <div className="space-y-8 text-base leading-7 text-ink/85">
          <section>
            <h2 className="text-display-3 mb-2 text-ink">Angaben gemäß § 5 TMG</h2>
            <p>
              Vincent Fitsch
              <br />
              Birkenweg 7a
              <br />
              83064 Raubling
              <br />
              Deutschland
            </p>
            <p className="mt-3 text-sm text-smoke">
              Anbieter im Sinne des § 5 TMG ist die oben genannte natürliche Person.
              Buddy wird derzeit als Einzelunternehmen betrieben; ein Eintrag im
              Handelsregister besteht nicht, eine Umsatzsteuer-Identifikationsnummer
              wurde nicht erteilt.
            </p>
          </section>

          <section>
            <h2 className="text-display-3 mb-2 text-ink">Kontakt</h2>
            <p>
              E-Mail:{" "}
              <a className="text-purple hover:underline" href="mailto:vincent@get-buddy.com">
                vincent@get-buddy.com
              </a>
            </p>
          </section>

          <section>
            <h2 className="text-display-3 mb-2 text-ink">
              Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV
            </h2>
            <p>Vincent Fitsch, Anschrift wie oben.</p>
          </section>

          <section>
            <h2 className="text-display-3 mb-2 text-ink">EU-Streitbeilegung</h2>
            <p>
              Die Europäische Kommission stellt eine Plattform zur Online-Streit­
              beilegung (OS) bereit:{" "}
              <a
                className="text-purple hover:underline"
                href="https://ec.europa.eu/consumers/odr/"
                target="_blank"
                rel="noopener noreferrer"
              >
                https://ec.europa.eu/consumers/odr/
              </a>
              . Der Anbieter ist weder verpflichtet noch bereit, an
              Streit­beilegungs­verfahren vor einer Verbraucher­schlichtungs­stelle
              teilzunehmen.
            </p>
          </section>

          <section>
            <h2 className="text-display-3 mb-2 text-ink">Haftung für Inhalte</h2>
            <p>
              Die Inhalte dieser Website wurden mit größtmöglicher Sorgfalt erstellt.
              Für die Richtigkeit, Vollständigkeit und Aktualität der Inhalte kann
              keine Gewähr übernommen werden. Als Diensteanbieter sind wir gemäß § 7
              Abs. 1 TMG für eigene Inhalte auf diesen Seiten nach den allgemeinen
              Gesetzen verantwortlich.
            </p>
          </section>

          <section>
            <h2 className="text-display-3 mb-2 text-ink">Haftung für Links</h2>
            <p>
              Unser Angebot enthält Links zu externen Websites Dritter, auf deren
              Inhalte wir keinen Einfluss haben. Für die Inhalte der verlinkten
              Seiten ist stets der jeweilige Anbieter oder Betreiber der Seiten
              verantwortlich.
            </p>
          </section>
        </div>

        <div className="mt-12">
          <Link href="/" className="text-purple hover:underline">
            ← Zurück zur Startseite
          </Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
