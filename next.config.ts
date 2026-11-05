import type { NextConfig } from "next";
import { staticSecurityHeaders } from "./lib/security/headers";

const nextConfig: NextConfig = {
  // Cabeçalhos de segurança fixos para todas as rotas (a CSP completa, em modo Report-Only, é montada por requisição no proxy.ts).
  async headers() {
    return [{ source: "/:path*", headers: staticSecurityHeaders() }];
  },
  // A tela Prioridades foi unificada ao Hoje: links e favoritos antigos seguem para a nova tela (redirect permanente).
  async redirects() {
    return [{ source: "/prioridades", destination: "/hoje", permanent: true }];
  },
};

export default nextConfig;
