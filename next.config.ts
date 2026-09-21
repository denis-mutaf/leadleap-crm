import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next 16 при каждом dev-запуске генерирует AGENTS.md/CLAUDE.md в корне — нам не нужно.
  agentRules: false,
  // Переход назад и повторный заход на маршрут отдаются из клиентского кэша
  // роутера, а не новым кругом запросов к Supabase.
  experimental: {
    staleTimes: { dynamic: 60, static: 180 },
  },
};

export default nextConfig;
