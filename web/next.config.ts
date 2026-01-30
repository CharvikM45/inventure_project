import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Use web directory as project root so Turbopack resolves node_modules from here,
  // not from the repo root (avoids "Can't resolve 'tailwindcss'" when root has another lockfile).
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
