import Link from "next/link";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Impressum",
  description: "Impressum und Anbieterkennzeichnung der Buddy-Plattform.",
  robots: { index: false, follow: true },
};

export default function ImpressumPage() {
  return (
    <>
      <SiteHeader />
      <main className="container-narrow py-16 sm:py-24">
        <p className="eyebrow mb-4">Rechtliches</p>
        <h1 className="text-display-2 mb-8">Impressum</h1>

        <div className="prose-buddy space-y-6 text-base leading-7 text-ink/85">
          <section>
            <h2 className="text-display-3 mb-2 text-ink">Angaben gemäß § 5 TMG</h2>
            <p>
              Buddy (Arbeitstitel)<br />
              [Vor- und Nachname]<br />
              [Straße und Hausnummer]<br />
              [PLZ und Ort]<br />
              Deutschland
            </p>
          </section>

          <section>
            <h2 className="text-display-3 mb-2 text-ink">Kontakt</h2>
            <p>
              E-Mail: <a className="text-purple hover:underline" href="mailto:hello@buddy.example.com">hello@buddy.example.com</a>
            </p>
          </section>

          <section>
            <h2 className="text-display-3 mb-2 text-ink">Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h2>
            <p>[Vor- und Nachname], Anschrift wie oben.</p>
          </section>

          <section>
            <h2 className="text-display-3 mb-2 text-ink">Haftungshinweis</h2>
            <p>
              Trotz sorgfältiger inhaltlicher Kontrolle übernehmen wir keine Haftung für die
              Inhalte externer Links. Für den Inhalt verlinkter Seiten sind ausschließlich
              deren Betreiber verantwortlich.
            </p>
          </section>

          <p className="text-sm text-smoke">
            Hinweis: Diese Angaben sind Platzhalter und müssen vor dem Launch durch die
            endgültigen rechtlichen Angaben ersetzt werden.
          </p>
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
