import type { MetadataRoute } from "next";

/**
 * Faz o ImobFlux instalável como app (Adicionar à Tela de Início). Instalar abre em tela cheia, sem as barras do navegador.
 * Instalar não liga avisos sozinho: o aviso com o app fechado é o Web Push (docs/ESTUDO_WEB_PUSH.md), ativado em Preferências.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ImobFlux",
    short_name: "ImobFlux",
    description: "CRM para corretores imobiliários",
    lang: "pt-BR",
    // /conversas: quem abre o app quer a caixa de entrada (sem sessão, o proxy leva ao login).
    start_url: "/conversas",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f8fafc",
    theme_color: "#0f172a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
