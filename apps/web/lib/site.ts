// Single source of truth for site-wide constants used by metadata, sitemap,
// robots, and JSON-LD. Keeping them here ensures the canonical URL stays
// consistent across the SEO surface.

const FALLBACK_SITE_URL = "https://www.get-buddy.com";

const normalize = (raw: string | undefined): string => {
  const candidate = (raw ?? FALLBACK_SITE_URL).trim();
  // strip trailing slash so concatenation stays predictable
  return candidate.replace(/\/+$/, "");
};

export const SITE_URL = normalize(process.env.NEXT_PUBLIC_SITE_URL);

export const SITE_NAME = "Buddy";
export const SITE_ALT_NAMES = ["Buddy App", "Buddy Hilfe App"];

export const SITE_DESCRIPTION =
  "Buddy ist die hyperlokale Hilfe-App: Poste dein Problem, lege Preis und Radius fest, und ein verifizierter Buddy aus deiner Nachbarschaft meldet sich in Minuten.";

export const OG_TITLE = "Buddy – Hilfe in Minuten. Aus deiner Nachbarschaft.";

export const OG_DESCRIPTION =
  "Lokale Hilfe-App für Alltagsprobleme: Möbel, WLAN, Umzug, kleine Aufträge. Verifizierte Buddies in der Nähe – du wählst, mit wem du arbeitest.";

export const absoluteUrl = (path: string): string => {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
};
