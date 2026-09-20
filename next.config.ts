import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next 16 при каждом dev-запуске генерирует AGENTS.md/CLAUDE.md в корне — нам не нужно.
  agentRules: false,
};

export default nextConfig;
