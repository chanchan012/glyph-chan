import type { NextConfig } from "next";
const config: NextConfig = {
  devIndicators: false,
  poweredByHeader: false,
  // Paper's Node entry probes optional DOM adapters. The browser bundle uses its browser entry.
  serverExternalPackages: ["paper", "wawoff2", "fonteditor-core", "opentype.js"],
};
export default config;
