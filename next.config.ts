import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A tela Prioridades foi unificada ao Hoje: links e favoritos antigos seguem para a nova tela (redirect permanente).
  async redirects() {
    return [{ source: "/prioridades", destination: "/hoje", permanent: true }];
  },
};

export default nextConfig;
