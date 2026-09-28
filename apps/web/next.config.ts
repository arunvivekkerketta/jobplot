import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@jobpilot/core", "@jobpilot/db", "@jobpilot/llm"],
};

export default nextConfig;
