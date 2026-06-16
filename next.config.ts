import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Frontend-only prototype — no backend infra wired yet.
  // Pin the workspace root (a parent lockfile exists in the monorepo).
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
