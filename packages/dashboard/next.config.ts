import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@promptqueue/core"],
  output: "standalone",
};

export default nextConfig;
