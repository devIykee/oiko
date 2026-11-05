import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Optional separate build dir so a second local dev server can run beside another (e.g. UI screenshots). Default .next.
  ...(process.env.OIKO_DIST_DIR ? { distDir: process.env.OIKO_DIST_DIR } : {}),
  cacheComponents: true,
  transpilePackages: ["@oiko/ui", "@oiko/sdk"],
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
