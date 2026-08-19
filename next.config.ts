import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Traces only the files each route actually needs into `.next/standalone`,
  // so the Docker runtime stage doesn't need `node_modules` installed at all
  // (D-70's Node-runtime requirement — xlsx parsing and the pooled Postgres
  // driver — still holds; this only changes how that Node process ships).
  output: "standalone",
  experimental: {
    // `proxy.ts` (Clerk's middleware) clones every request body for
    // inspection, capped independently of any route handler's own limit —
    // the default (10mb) rejects the existing-customer loyalty export
    // before `existing-customers/route.ts` ever sees it. Raised to match
    // Vercel Functions' own 100mb request-body ceiling, not invented.
    proxyClientMaxBodySize: "100mb",
  },
};

export default nextConfig;
