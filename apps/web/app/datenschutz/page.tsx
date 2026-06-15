import Link from "next/link";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Datenschutz",
  description:
    "Informationen zur Verarbeitung personenbezogener Daten auf der Buddy-Landingpage gemäß DSGVO.",
  robots: { index: false, follow: true },
};

export default function DatenschutzPage() {
  return (
    <>
      <SiteHeader />
      <main className="container-narrow py-16 sm:py-24">
        <p className="eyebrow mb-4">Rechtliches</p>
        <h1 className="text-display-2 mb-8">Datenschutzerklärung</h1>

        <p className="mb-10 text-base leading-7 text-ink/75">
          Diese Datenschutzerklärung informiert über Art, Umfang und Zweck der
          Verarbeitung personenbezogener Daten auf{" "}
          <strong className="text-ink">www.get-buddy.com</strong>. Buddy ist
          aktuell eine Early-Access-Landingpage mit Warteliste; eine App im App
          Store oder im Google Play Store wird noch nicht angeboten.
        </p>

        <div className="space-y-10 text-base leading-7 text-ink/85">
          {/* 1 */}
          <section>
            <h2 className="text-display-3 mb-2 text-ink">1. Verantwortlicher</h2>
            <p>
              Verantwortlich für die Verarbeitung personenbezogener Daten auf
              dieser Website im Sinne der DSGVO ist:
            </p>
            <p className="mt-3">
              Vincent Fitsch
              <br />
              Birkenweg 7a
              <br />
              83064 Raubling
              <br />
              Deutschland
            </p>
          </section>

          {/* 2 */}
          <section>
            <h2 className="text-display-3 mb-2 text-ink">2. Datenschutz-Kontakt</h2>
            <p>
              Anfragen zum Datenschutz, zur Wahrnehmung von Betroffenenrechten
              oder zum Widerruf erteilter Einwilligungen können per E-Mail an{" "}
              <a
                className="text-purple hover:underline"
                href="mailto:vincent@get-buddy.com"
              >
                vincent@get-buddy.com
              </a>{" "}
              gerichtet werden.
            </p>
            <p className="mt-3 text-sm text-smoke">
              Eine Datenschutzbeauftragte oder ein Datenschutzbeauftragter wurde
              nicht benannt, da die gesetzlichen Voraussetzungen hierfür derzeit
              nicht vorliegen.
            </p>
          </section>

          {/* 3 */}
          <section>
            <h2 className="text-display-3 mb-2 text-ink">3. Hosting (Vercel)</h2>
            <p>
              Diese Website wird gehostet bei der{" "}
              <strong className="text-ink">Vercel Inc.</strong>, 440 N Barranca
              Ave #4133, Covina, CA 91723, USA. Beim Aufruf der Website
              verarbeitet Vercel technische Zugriffsdaten, insbesondere
              IP-Adresse, Datum und Uhrzeit der Anfrage, aufgerufene URL,
              Referrer-URL sowie Browser- und Geräteinformationen
              (User-Agent). Diese Daten sind erforderlich, um die Website
              zuverlässig auszuliefern, die Sicherheit zu gewährleisten und
              Angriffe abzuwehren.
            </p>
            <p className="mt-3">
              Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (berechtigtes
              Interesse am sicheren und stabilen Betrieb der Website). Vercel
              betreibt ein globales Edge-Netzwerk; eine Verarbeitung
              personenbezogener Daten außerhalb der EU, insbesondere in den
              USA, ist daher nicht ausgeschlossen. Sofern Daten in Drittländer
              übermittelt werden, erfolgt dies auf Grundlage geeigneter
              Garantien gemäß Art. 44 ff. DSGVO (z. B. EU-Standardvertragsklauseln).
            </p>
            <p className="mt-3 text-sm text-smoke">
              Hinweis: Das Projekt wird derzeit auf dem kostenfreien Vercel
              Hobby Plan betrieben; ein gesonderter Auftragsverarbeitungsvertrag
              (DPA) wurde mit Vercel bislang nicht abgeschlossen.
            </p>
          </section>

          {/* 4 */}
          <section>
            <h2 className="text-display-3 mb-2 text-ink">
              4. Warteliste &amp; Datenbank (Supabase)
            </h2>
            <p>
              Bei der Eintragung in die Warteliste werden ausschließlich die
              von dir angegebenen Daten verarbeitet:
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5">
              <li>Name (Pflichtfeld)</li>
              <li>E-Mail-Adresse (Pflichtfeld)</li>
              <li>Stadt (optional)</li>
              <li>Rolle (optional, z.&nbsp;B. „Ich brauche Hilfe&ldquo;, „Ich möchte als Buddy helfen&ldquo;)</li>
              <li>Nachricht (optional)</li>
              <li>Quellkennzeichnung („landing_page&ldquo;) und Zeitstempel der Eintragung</li>
            </ul>
            <p className="mt-3">
              IP-Adressen oder User-Agents werden in der Wartelisten-Datenbank
              <em> nicht</em> gespeichert. Eine Weiterleitung der Anmeldungen
              an Team-Postfächer findet nicht statt.
            </p>
            <p className="mt-3">
              <strong>Zwecke:</strong> Wir verwenden diese Daten ausschließlich,
              um dich über den Start des Early Access zu informieren, dir
              produktbezogene Updates zu Buddy zu senden sowie Feedback im
              Rahmen des Pilots einzuholen. Einen allgemeinen Newsletter
              versenden wir nicht.
            </p>
            <p className="mt-3">
              <strong>Rechtsgrundlagen:</strong> Art. 6 Abs. 1 lit. a DSGVO
              (Einwilligung durch aktives Absenden des Formulars) sowie –
              soweit deine Anfrage auf die Anbahnung eines zukünftigen
              Vertrags­verhältnisses gerichtet ist – Art. 6 Abs. 1 lit. b
              DSGVO (vorvertragliche Kommunikation). Du kannst deine
              Einwilligung jederzeit für die Zukunft widerrufen, indem du eine
              kurze Nachricht an{" "}
              <a className="text-purple hover:underline" href="mailto:vincent@get-buddy.com">
                vincent@get-buddy.com
              </a>{" "}
              schickst.
            </p>
            <p className="mt-3 text-sm text-smoke">
              Die Eintragung erfolgt derzeit als einfaches Opt-in ohne
              Double-Opt-in-Bestätigungsmail. Ein Double-Opt-in kann zu einem
              späteren Zeitpunkt eingeführt werden; diese Datenschutzerklärung
              wird dann entsprechend aktualisiert.
            </p>
            <p className="mt-3">
              Die Wartelisten-Daten werden in unserem Auftrag durch{" "}
              <strong className="text-ink">Supabase Inc.</strong>, 970 Toa
              Payoh North #07-04, Singapur 318992, gespeichert. Die Daten
              liegen in der Region <em>eu-central-2 (Zürich, Schweiz)</em>.
              Die Schweiz ist von der Europäischen Kommission als Land mit
              angemessenem Datenschutzniveau anerkannt (Angemessenheits­beschluss
              gemäß Art. 45 DSGVO). Mit Supabase wurde ein
              Auftrags­verarbeitungs­vertrag (DPA) abgeschlossen. Eine
              Verarbeitung außerhalb des Europäischen Wirtschaftsraums durch
              Supabase im Rahmen von Support oder Plattformbetrieb ist nicht
              ausgeschlossen und erfolgt in diesem Fall auf Grundlage
              geeigneter Garantien gemäß Art. 44 ff. DSGVO.
            </p>
          </section>

          {/* 5 */}
          <section>
            <h2 className="text-display-3 mb-2 text-ink">
              5. E-Mail-Kommunikation (Google Workspace)
            </h2>
            <p>
              Für die Bearbeitung von Kontaktanfragen, Datenschutz-Anfragen und
              Wartelisten-Korrespondenz nutzen wir{" "}
              <strong className="text-ink">Google Workspace</strong> der Google
              Ireland Limited (Gordon House, Barrow Street, Dublin 4, Irland).
              Wenn du uns eine E-Mail schickst, werden die übermittelten Daten
              (E-Mail-Adresse, Name, Nachrichtinhalt sowie technische
              Metadaten) bei Google verarbeitet, um die Nachricht zustellen
              und beantworten zu können.
            </p>
            <p className="mt-3">
              Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (berechtigtes
              Interesse an der Beantwortung von Anfragen) bzw. – sofern die
              Anfrage auf einen Vertrag abzielt – Art. 6 Abs. 1 lit. b DSGVO.
              Google kann personenbezogene Daten auch außerhalb der EU,
              insbesondere in den USA, verarbeiten. Diese Übermittlung erfolgt
              auf Grundlage geeigneter Garantien gemäß Art. 44 ff. DSGVO
              (insbesondere EU-Standardvertragsklauseln sowie ggf. dem
              EU-US Data Privacy Framework).
            </p>
          </section>

          {/* 6 */}
          <section>
            <h2 className="text-display-3 mb-2 text-ink">6. DNS (Cloudflare)</h2>
            <p>
              Die DNS-Auflösung der Domain <code>get-buddy.com</code> erfolgt
              über die{" "}
              <strong className="text-ink">Cloudflare, Inc.</strong>, 101
              Townsend Street, San Francisco, CA 94107, USA. Cloudflare wird
              ausschließlich als DNS-Anbieter eingesetzt; der HTTP-Traffic
              dieser Website läuft <em>nicht</em> über das Cloudflare-Netzwerk
              (kein Reverse-Proxy, kein CDN). Im Rahmen der DNS-Auflösung kann
              Cloudflare die IP-Adresse des anfragenden Resolvers und den
              angefragten Hostnamen verarbeiten. Rechtsgrundlage ist Art. 6
              Abs. 1 lit. f DSGVO (berechtigtes Interesse an einer
              zuverlässigen Namensauflösung).
            </p>
          </section>

          {/* 7 */}
          <section>
            <h2 className="text-display-3 mb-2 text-ink">7. Cookies und Tracking</h2>
            <p>
              Diese Website setzt <strong>keine</strong> Tracking-Cookies, kein
              Webanalyse-Tool, keine Werbe-Pixel, keine externen Schriftarten,
              keine eingebetteten Karten oder iframes, kein Captcha und kein
              Monitoring-/Crash-Reporting-Tool ein. Es ist daher kein
              Cookie-Banner erforderlich.
            </p>
          </section>

          {/* 8 */}
          <section>
            <h2 className="text-display-3 mb-2 text-ink">8. Rechtsgrundlagen im Überblick</h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong>Art. 6 Abs. 1 lit. a DSGVO</strong> – Einwilligung,
                insbesondere für die freiwillige Eintragung in die Warteliste.
              </li>
              <li>
                <strong>Art. 6 Abs. 1 lit. b DSGVO</strong> – vorvertragliche
                Kommunikation, soweit eine Anfrage auf den späteren Abschluss
                eines Vertrags gerichtet ist.
              </li>
              <li>
                <strong>Art. 6 Abs. 1 lit. f DSGVO</strong> – berechtigtes
                Interesse am sicheren, stabilen und missbrauchsfreien Betrieb
                der Website (Hosting, Zustellung von E-Mails, DNS-Auflösung).
              </li>
            </ul>
          </section>

          {/* 9 */}
          <section>
            <h2 className="text-display-3 mb-2 text-ink">9. Speicherdauer</h2>
            <p>
              Wartelisten-Daten werden bis zu <strong>24 Monate</strong> nach
              deiner Eintragung gespeichert – oder bis zu einem früheren
              Zeitpunkt, wenn du die Löschung oder den Widerruf deiner
              Einwilligung verlangst. Technische Zugriffsdaten, die Vercel im
              Rahmen des Hostings verarbeitet, werden gemäß den Aufbewahrungs­
              fristen von Vercel verarbeitet und gespeichert.
            </p>
          </section>

          {/* 10 */}
          <section>
            <h2 className="text-display-3 mb-2 text-ink">10. Deine Rechte</h2>
            <p>Du hast jederzeit das Recht auf:</p>
            <ul className="mt-3 list-disc space-y-1 pl-5">
              <li>Auskunft über die zu deiner Person gespeicherten Daten (Art. 15 DSGVO)</li>
              <li>Berichtigung unrichtiger Daten (Art. 16 DSGVO)</li>
              <li>Löschung („Recht auf Vergessenwerden&ldquo;, Art. 17 DSGVO)</li>
              <li>Einschränkung der Verarbeitung (Art. 18 DSGVO)</li>
              <li>Datenübertragbarkeit (Art. 20 DSGVO)</li>
              <li>
                Widerspruch gegen eine Verarbeitung auf Grundlage berechtigter
                Interessen (Art. 21 DSGVO)
              </li>
              <li>
                Widerruf einer erteilten Einwilligung mit Wirkung für die
                Zukunft (Art. 7 Abs. 3 DSGVO)
              </li>
            </ul>
            <p className="mt-3">
              Du kannst diese Rechte formlos per E-Mail an{" "}
              <a className="text-purple hover:underline" href="mailto:vincent@get-buddy.com">
                vincent@get-buddy.com
              </a>{" "}
              geltend machen.
            </p>
          </section>

          {/* 11 */}
          <section>
            <h2 className="text-display-3 mb-2 text-ink">
              11. Beschwerderecht bei der Aufsichtsbehörde
            </h2>
            <p>
              Du hast das Recht, dich bei einer Datenschutz-Aufsichtsbehörde
              über die Verarbeitung deiner personenbezogenen Daten zu
              beschweren (Art. 77 DSGVO). Für uns örtlich zuständig ist:
            </p>
            <p className="mt-3">
              <strong className="text-ink">
                Bayerisches Landesamt für Datenschutzaufsicht (BayLDA)
              </strong>
              <br />
              Promenade 18
              <br />
              91522 Ansbach
              <br />
              Deutschland
              <br />
              <a
                className="text-purple hover:underline"
                href="https://www.lda.bayern.de"
                target="_blank"
                rel="noopener noreferrer"
              >
                www.lda.bayern.de
              </a>
            </p>
          </section>

          {/* 12 */}
          <section>
            <h2 className="text-display-3 mb-2 text-ink">
              12. Änderungen dieser Datenschutzerklärung
            </h2>
            <p>
              Wir passen diese Datenschutzerklärung an, sobald sich
              Verarbeitungen ändern – etwa wenn Buddy als App in den App
              Store / Play Store kommt, eine Identitäts­verifizierung
              eingeführt wird, ein Newsletter-Tool, ein Analyse-Werkzeug oder
              ein Double-Opt-in für die Warteliste hinzukommt. Die jeweils
              aktuelle Fassung ist unter{" "}
              <a className="text-purple hover:underline" href="https://www.get-buddy.com/datenschutz">
                www.get-buddy.com/datenschutz
              </a>{" "}
              abrufbar.
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
