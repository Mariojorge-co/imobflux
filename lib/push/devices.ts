// Web Push no aparelho: textos e decisões puras (testáveis sem navegador).

import type { Platform } from "@/lib/notifications/device";

/** Chave pública VAPID (base64 seguro para URL) no formato que o `pushManager.subscribe` pede. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

export type PushUiState =
  /** Ainda descobrindo o que o aparelho suporta (primeira pintura). */
  | "checking"
  /** O servidor não tem as chaves VAPID: recurso desligado. */
  | "unavailable"
  /** iPhone/iPad fora do app instalado na Tela de Início (única forma de o iOS liberar aviso). */
  | "needs-install"
  /** Navegador sem service worker, Push ou Notification. */
  | "unsupported"
  /** Permissão negada no aparelho. */
  | "denied"
  /** Pode ativar (permissão ainda não pedida ou concedida sem assinatura). */
  | "inactive"
  /** Este aparelho tem assinatura registrada. */
  | "active";

export type PushCapabilities = {
  configured: boolean;
  platform: Platform;
  /** App instalado na Tela de Início (standalone). */
  installed: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  permission: NotificationPermission | "unsupported";
  subscribed: boolean;
};

export function decidePushState(capabilities: PushCapabilities): PushUiState {
  if (!capabilities.configured) return "unavailable";
  // No iOS o Safari em aba nem oferece PushManager: a orientação certa é instalar o app, não "navegador sem suporte".
  if (capabilities.platform === "ios" && !capabilities.installed) return "needs-install";
  if (!capabilities.hasServiceWorker || !capabilities.hasPushManager || !capabilities.hasNotification) return "unsupported";
  if (capabilities.permission === "denied") return "denied";
  return capabilities.subscribed && capabilities.permission === "granted" ? "active" : "inactive";
}

export const INSTALL_STEPS_IOS = [
  "Abra o ImobFlux no Safari.",
  "Toque em Compartilhar (o quadrado com a seta para cima).",
  "Toque em “Adicionar à Tela de Início” e confirme.",
  "Abra o ImobFlux pelo ícone novo na Tela de Início e volte aqui para ativar.",
];

export function reenableSteps(platform: Platform, installed: boolean): string {
  if (platform === "ios") {
    return installed
      ? "Abra os Ajustes do iPhone, toque em Notificações, escolha ImobFlux e ligue “Permitir notificações”."
      : "Instale o ImobFlux na Tela de Início e ative por lá.";
  }
  if (platform === "android") return "Toque no cadeado ao lado do endereço, abra Permissões, escolha Notificações e toque em Permitir.";
  return "Clique no cadeado ao lado do endereço, procure Notificações e escolha Permitir. Depois recarregue a página.";
}

/** Nome curto do aparelho para a lista (sem guardar nada além do que o navegador já informa). */
export function describeDevice(platform: string, userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Chrome\/|CriOS/.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "navegador";
  const system = platform === "ios" ? "iPhone/iPad" : platform === "android" ? "Android" : "Computador";
  return `${system} · ${browser}`;
}
