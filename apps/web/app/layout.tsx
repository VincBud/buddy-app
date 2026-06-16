import type { Metadata, Viewport } from "next";
import "./globals.css";
import {
  OG_DESCRIPTION,
  OG_TITLE,
  SITE_ALT_NAMES,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
} from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  title: {
    default: "Buddy – Hilfe in Minuten. Aus deiner Nachbarschaft.",
    template: "%s · Buddy – Lokale Hilfe-App",
  },
  description: SITE_DESCRIPTION,
  keywords: [
    "Buddy",
    "Buddy App",
    "Buddy Hilfe App",
    "lokale Hilfe App",
    "Nachbarschaftshilfe App",
    "Hilfe in der Nähe",
    "spontane Hilfe",
    "Alltagsprobleme lösen",
    "Helfer in der Nähe finden",
    "Hyperlokal",
    "On-Demand Hilfe",
    "Nachbarschaftshilfe",
    "Rosenheim Test",
    "Pilot in Rosenheim",
    "Deutschland Early Access",
  ],
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  category: "lifestyle",
  formatDetection: { telephone: false, email: false, address: false },
  alternates: {
    canonical: SITE_URL,
    languages: { "de-DE": SITE_URL },
  },
  openGraph: {
    type: "website",
    locale: "de_DE",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: OG_TITLE,
    description: OG_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: OG_TITLE,
    description: OG_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    nocache: false,
    googleBot: {
      index: true,
      follow: true,
      "max-snippet": -1,
      "max-image-preview": "large",
      "max-video-preview": -1,
    },
  },
};

export const viewport: Viewport = {
  themeColor: "#FEFCFD",
  width: "device-width",
  initialScale: 1,
};

// Site-wide JSON-LD: WebSite + Organization. The landing page itself injects
// additional SoftwareApplication and FAQPage schemas so they only apply to /.
const siteJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}#website`,
      url: SITE_URL,
      name: SITE_NAME,
      alternateName: SITE_ALT_NAMES,
      inLanguage: "de-DE",
      description: SITE_DESCRIPTION,
      publisher: { "@id": `${SITE_URL}#organization` },
    },
    {
      "@type": "Organization",
      "@id": `${SITE_URL}#organization`,
      name: SITE_NAME,
      alternateName: SITE_ALT_NAMES,
      url: SITE_URL,
      description:
        "Buddy ist ein hyperlokaler Marktplatz für Alltagshilfe in Deutschland. Erste Testphase in Rosenheim, Early Access in Vorbereitung.",
      areaServed: { "@type": "Country", name: "Deutschland" },
      knowsLanguage: ["de"],
    },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <head>
        <script
          type="application/ld+json"
          // Static, server-rendered JSON-LD — safe to inject as raw HTML.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd) }}
        />
      </head>
      <body className="min-h-screen bg-paper text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
