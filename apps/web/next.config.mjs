import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Baseline HTTP security headers. Kept intentionally conservative — no CSP
// here because Next.js inlines its hydration runtime and we render JSON-LD
// via dangerouslySetInnerHTML on layout, page and FAQ; a strict CSP would
// need 'unsafe-inline' or nonces and was out of scope for this pass. Vercel
// already adds HSTS at the platform layer.
const SECURITY_HEADERS = [
  // Clickjacking — landing page is never meant to be framed.
  { key: "X-Frame-Options", value: "DENY" },
  // Block MIME-type sniffing on every static asset.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Send full path for same-origin nav, only origin for cross-origin so we
  // don't leak query strings to external destinations.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Opt out of every powerful browser feature the landing page does not use.
  // FLoC/Topics opt-out is included via `interest-cohort=()` /
  // `browsing-topics=()`.
  {
    key: "Permissions-Policy",
    value:
      "accelerometer=(), autoplay=(), browsing-topics=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), interest-cohort=(), magnetometer=(), microphone=(), midi=(), payment=(), usb=(), xr-spatial-tracking=()",
  },
  // Cross-origin isolation defaults — harmless on a 1st-party static site.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The parent buddy-app directory also has a lockfile (the Expo app).
  // Pin Next.js's tracing root to apps/web so it doesn't infer the
  // monorepo root and warn on every build.
  outputFileTracingRoot: __dirname,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
