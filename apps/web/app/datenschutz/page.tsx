import Link from "next/link";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Datenschutz",
  description: "Informationen zur Verarbeitung personenbezogener Daten auf der Buddy-Landingpage.",
  robots: { index: false, follow: true },
};

export default function DatenschutzPage() {
  return (
    <>
      <SiteHeader />
      <main className="container-narrow py-16 sm:py-24">
        <p className="eyebrow mb-4">Rechtliches</p>
        <h1 className="text-display-2 mb-8">Datenschutzerklärung</h1>

        <div className="space-y-6 text-base leading-7 text-ink/85">
          <section>
            <h2 className="text-display-3 mb-2 text-ink">1. Verantwortlicher</h2>
            <p>
              Verantwortlich für die Datenverarbeitung auf dieser Website ist die im
              Impressum genannte Person. Anfragen zum Datenschutz können per E-Mail an
              {" "}
              <a className="text-purple hover:underline" href="mailto:privacy@buddy.example.com">
                privacy@buddy.example.com
              </a>{" "}
              gerichtet werden.
            </p>
          </section>

          <section>
            <h2 className="text-display-3 mb-2 text-ink">2. Daten der Warteliste</h2>
            <p>
              Wenn du dich auf die Warteliste einträgst, verarbeiten wir die von dir
              angegebenen Daten (Name, E-Mail-Adresse, optional Stadt, Rolle und
              Nachricht) ausschließlich, um dich über den Start des Early Access zu
              informieren. Rechtsgrundlage ist Art. 6 Abs. 1 lit. a DSGVO (Einwilligung).
            </p>
            <p>
              Wir geben diese Daten nicht an Dritte weiter und löschen sie spätestens 24
              Monate nach deiner Eintragung oder unmittelbar auf Wunsch.
            </p>
          </section>

          <section>
            <h2 className="text-display-3 mb-2 text-ink">3. Hosting & Datenbank</h2>
            <p>
              Diese Seite wird auf Vercel gehostet. Wartelisten-Daten werden bei Supabase
              (Auftragsverarbeiter) in der EU gespeichert. Beide Anbieter verarbeiten in
              unserem Auftrag und auf Grundlage eines Auftragsverarbeitungsvertrags.
            </p>
          </section>

          <section>
            <h2 className="text-display-3 mb-2 text-ink">4. Deine Rechte</h2>
            <p>
              Du hast jederzeit das Recht auf Auskunft, Berichtigung, Löschung,
              Einschränkung der Verarbeitung, Datenübertragbarkeit sowie auf Widerspruch
              und Widerruf erteilter Einwilligungen.
            </p>
          </section>

          <p className="text-sm text-smoke">
            Hinweis: Dieser Text ist ein Platzhalter und ersetzt keine individuelle
            Rechtsberatung. Vor dem Launch durch eine vollständige
            Datenschutzerklärung ersetzen.
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
