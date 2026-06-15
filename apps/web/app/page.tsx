import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SectionHero } from "@/components/section-hero";
import { SectionProblem } from "@/components/section-problem";
import { SectionHowItWorks } from "@/components/section-how-it-works";
import { SectionScreenshots } from "@/components/section-screenshots";
import { SectionSafety } from "@/components/section-safety";
import { SectionMvpStatus } from "@/components/section-mvp-status";
import { SectionFaq } from "@/components/section-faq";
import { SectionWaitlist } from "@/components/section-waitlist";
import { SITE_ALT_NAMES, SITE_NAME, SITE_URL } from "@/lib/site";

// Page-scoped JSON-LD. The Organization and WebSite schemas live in the root
// layout; here we describe the product itself as a SoftwareApplication so
// Google understands the brand category — local services / lifestyle utility,
// NOT dating, NOT a generic "body" app.
const softwareAppJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "@id": `${SITE_URL}#app`,
  name: SITE_NAME,
  alternateName: SITE_ALT_NAMES,
  url: SITE_URL,
  description:
    "Buddy ist eine hyperlokale Hilfe-App und ein Marktplatz für Alltagsprobleme: Problem posten, Preis festlegen, verifizierten Helfer auswählen, im Chat klären, fertig.",
  applicationCategory: "LifestyleApplication",
  applicationSubCategory: "Local Services Marketplace",
  operatingSystem: "iOS, Android",
  inLanguage: "de-DE",
  audience: { "@type": "Audience", audienceType: "Nachbarschaft in Deutschland" },
  featureList: [
    "Problem posten in unter einer Minute",
    "Preis und Radius selbst festlegen",
    "Verifizierte Buddies in der Nähe finden",
    "Helfer auswählen statt vermittelt bekommen",
    "Direkter Chat nach Auswahl",
    "Beidseitige Bewertungen nach jedem Auftrag",
  ],
  isAccessibleForFree: true,
  releaseNotes: "MVP getestet, Pilot in Vorbereitung, Early Access geöffnet.",
  publisher: { "@id": `${SITE_URL}#organization` },
};

export default function LandingPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareAppJsonLd) }}
      />
      <SiteHeader />
      <main>
        <SectionHero />
        <SectionProblem />
        <SectionHowItWorks />
        <SectionScreenshots />
        <SectionSafety />
        <SectionMvpStatus />
        <SectionFaq />
        <SectionWaitlist />
      </main>
      <SiteFooter />
    </>
  );
}
