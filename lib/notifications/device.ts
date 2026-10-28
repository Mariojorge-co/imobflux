// O que os avisos conseguem fazer em cada aparelho, em linguagem simples (mostrado nas Preferências).

export type Platform = "ios" | "android" | "desktop";

export type DeviceSupport = {
  platform: Platform;
  /** iPhone/iPad com o ImobFlux instalado na tela inicial (único jeito de o iOS liberar aviso do sistema). */
  installed: boolean;
};

export function detectPlatform(userAgent: string, maxTouchPoints = 0): Platform {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "ios";
  // iPadOS recente se apresenta como Mac, mas tem tela de toque.
  if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return "ios";
  if (/Android/i.test(userAgent)) return "android";
  return "desktop";
}

export function detectDeviceSupport(userAgent: string, maxTouchPoints: number, standalone: boolean): DeviceSupport {
  return { platform: detectPlatform(userAgent, maxTouchPoints), installed: standalone };
}

export type DeviceGuide = { platform: Platform; label: string; works: string; limits: string };

export const DEVICE_GUIDES: DeviceGuide[] = [
  {
    platform: "desktop",
    label: "Computador (Chrome, Edge, Firefox, Safari)",
    works: "Número no título da aba, som e aviso do sistema, com o ImobFlux aberto em qualquer aba (mesmo em segundo plano).",
    limits: "Com o navegador ou a aba fechados não avisa: isso exige o envio de avisos pelo servidor (Web Push), próxima etapa.",
  },
  {
    platform: "android",
    label: "Android (Chrome)",
    works: "Número no título, som (depois do primeiro toque na tela) e aviso do sistema com o ImobFlux aberto ou recém-deixado em segundo plano.",
    limits: "O Android suspende abas paradas em segundo plano; aí nada chega até você voltar ao app. Com o app fechado não avisa (Web Push, próxima etapa).",
  },
  {
    platform: "ios",
    label: "iPhone e iPad (Safari)",
    works: "Número no título e som (depois do primeiro toque) com a tela aberta. O aviso do sistema só existe com o ImobFlux instalado na tela inicial (Compartilhar › Adicionar à Tela de Início), no iOS 16.4 ou mais novo.",
    limits: "O iPhone congela a página assim que você sai dela; sem Web Push (próxima etapa) não há aviso com o app fechado ou em segundo plano.",
  },
];

/** Frase curta sobre o aparelho atual, para o painel de diagnóstico. */
export function deviceSummary(device: DeviceSupport): string {
  if (device.platform === "ios") {
    return device.installed
      ? "iPhone com o app instalado na tela inicial: o aviso do sistema pode funcionar."
      : "iPhone no navegador: o aviso do sistema só funciona depois de instalar o ImobFlux na tela inicial.";
  }
  if (device.platform === "android") return "Android: o aviso do sistema usa um serviço do navegador e funciona com o app aberto ou recente em segundo plano.";
  return "Computador: título, som e aviso do sistema funcionam com o ImobFlux aberto numa aba.";
}
