import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The parent buddy-app directory also has a lockfile (the Expo app).
  // Pin Next.js's tracing root to apps/web so it doesn't infer the
  // monorepo root and warn on every build.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
