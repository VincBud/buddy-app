import type { Metadata, Viewport } from "next";
import "./globals.css";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://buddy.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Buddy — Hyperlokale Hilfe in Minuten",
    template: "%s · Buddy",
  },
  description:
    "Buddy verbindet dich mit verifizierten Nachbarn, die im Alltag helfen. Poste dein Problem, setze Preis und Radius — ein lokaler Buddy meldet sich in Minuten.",
  keywords: [
    "Buddy",
    "Nachbarschaftshilfe",
    "Hyperlokal",
    "On-Demand",
    "Marktplatz",
    "Hilfe",
    "Verifiziert",
  ],
  openGraph: {
    type: "website",
    locale: "de_DE",
    url: SITE_URL,
    siteName: "Buddy",
    title: "Buddy — Hyperlokale Hilfe in Minuten",
    description:
      "Verifizierte Nachbarn helfen dir im Alltag — vom WLAN-Reset bis zum Möbelaufbau. Buddy macht aus deinem Problem eine Aufgabe und aus deiner Nachbarschaft ein Team.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Buddy — Hyperlokale Hilfe in Minuten",
    description:
      "Poste dein Problem, lege Budget und Radius fest. Verifizierte Buddies bewerben sich — du wählst.",
  },
  robots: { index: true, follow: true },
  alternates: { canonical: SITE_URL },
};

export const viewport: Viewport = {
  themeColor: "#FEFCFD",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body className="min-h-screen bg-paper text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
