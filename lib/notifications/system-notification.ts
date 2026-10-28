// Aviso do sistema (a janelinha do navegador/celular). No Android/Chrome `new Notification()` falha: o caminho certo é o service worker
// (`registration.showNotification`). O worker mínimo em /sw-avisos.js só exibe o aviso local e abre a conversa ao tocar; não há Web Push.

import type { ChannelResult } from "@/lib/notifications/diagnostics";

export const SERVICE_WORKER_URL = "/sw-avisos.js";
export const OPEN_CONVERSATION_MESSAGE = "imobflux:open-conversation";

export function notificationPermission(): NotificationPermission | "unsupported" {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

/** Registra o service worker mínimo (idempotente). Sem suporte ou com falha, devolve null e o aviso cai no `new Notification`. */
export async function registerNotificationWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: "/" });
  } catch {
    return null;
  }
}

export function conversationPath(conversationId: string): string {
  return `/conversas/${conversationId}`;
}

type ShowOptions = { title: string; body: string; tag: string; conversationId?: string; onOpen?: (path: string) => void };

/** Mostra o aviso do sistema. Não pede permissão (isso só pode ser feito num gesto, nas Preferências). */
export async function showSystemNotification({ title, body, tag, conversationId, onOpen }: ShowOptions): Promise<ChannelResult> {
  const permission = notificationPermission();
  if (permission === "unsupported") return "unsupported";
  if (permission !== "granted") return "denied";
  const path = conversationId ? conversationPath(conversationId) : "/conversas";
  try {
    const registration = await registerNotificationWorker();
    if (registration) {
      const ready = await navigator.serviceWorker.ready;
      await ready.showNotification(title, { body, tag, data: { path } });
      return "ok";
    }
  } catch {
    // tenta o aviso direto abaixo
  }
  try {
    const notification = new Notification(title, { body, tag });
    notification.onclick = () => {
      window.focus();
      onOpen?.(path);
      notification.close();
    };
    return "ok";
  } catch {
    return "error";
  }
}
