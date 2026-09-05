import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @aegis/shared ships TypeScript source (no build step); Next compiles it like app code.
  transpilePackages: ["@aegis/shared"],
  // `.wgsl` files import like modules through vgpu's loader (its Next.js guide). `as: "*.js"` is required so Turbopack
  // treats the loader output as JavaScript. Neither `next dev` nor `next build` validates WGSL; `vgpu check` does.
  turbopack: {
    rules: {
      "*.wgsl": { loaders: ["@vgpu/wgsl/loader-webpack"], as: "*.js" },
    },
  },
};

export default nextConfig;
