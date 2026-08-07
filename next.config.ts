import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Traces only the files each route actually needs into `.next/standalone`,
  // so the Docker runtime stage doesn't need `node_modules` installed at all
  // (D-70's Node-runtime requirement — xlsx parsing and the pooled Postgres
  // driver — still holds; this only changes how that Node process ships).
  output: "standalone",
};

export default nextConfig;
