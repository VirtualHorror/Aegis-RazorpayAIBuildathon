import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @aegis/shared ships TypeScript source (no build step); Next compiles it like app code.
  transpilePackages: ["@aegis/shared"],
};

export default nextConfig;
