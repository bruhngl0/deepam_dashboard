import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: '/crm/marketing/:path*',
        destination: '/marketing/:path*',
        permanent: true,
      },
      // Salespeople moved out of Customer Intelligence into HR Intelligence; Reports was removed.
      { source: '/crm/salespeople/incentives', destination: '/hr/incentives', permanent: true },
      { source: '/crm/salespeople/:path*', destination: '/hr/salespeople/:path*', permanent: true },
      { source: '/reports/salespeople/match', destination: '/hr/salespeople', permanent: true },
      // Name matching was removed from HR Intelligence.
      { source: '/hr/match', destination: '/hr/salespeople', permanent: false },
      { source: '/reports/salespeople', destination: '/hr/salespeople', permanent: true },
      { source: '/reports/:path*', destination: '/', permanent: false },
    ];
  },
  // Traces only the files each route actually needs into `.next/standalone`,
  // so the Docker runtime stage doesn't need `node_modules` installed at all
  // (D-70's Node-runtime requirement — xlsx parsing and the pooled Postgres
  // driver — still holds; this only changes how that Node process ships).
  output: "standalone",
  turbopack: {
    root: __dirname,
  },
  experimental: {
    // `proxy.ts` (Clerk's middleware) clones every request body for
    // inspection, capped independently of any route handler's own limit —
    // the default (10mb) rejects the existing-customer loyalty export
    // before `existing-customers/route.ts` ever sees it, so it is raised to 100mb.
    proxyClientMaxBodySize: "100mb",
  },
};

export default nextConfig;
