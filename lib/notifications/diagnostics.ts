// Estado de diagnóstico dos avisos, só em memória (some ao recarregar). Nunca guarda texto de mensagem nem nome de cliente:
// apenas horários, o estado da conexão em tempo real e o MOTIVO do último aviso ignorado.

import type { IgnoreReason } from "@/lib/notifications/model";

export type RealtimeStatus = "connecting" | "connected" | "disconnected";
export type ChannelResult = "ok" | "blocked" | "denied" | "unsupported" | "error";

export type TestOutcome = {
  at: number;
  title: ChannelResult;
  sound: ChannelResult;
  system: ChannelResult;
};

export type NotificationDiagnostics = {
  realtime: RealtimeStatus;
  lastEventAt: number | null;
  lastIgnored: { reason: IgnoreReason; at: number } | null;
  lastNotifiedAt: number | null;
  lastTest: TestOutcome | null;
};

let state: NotificationDiagnostics = {
  realtime: "connecting",
  lastEventAt: null,
  lastIgnored: null,
  lastNotifiedAt: null,
  lastTest: null,
};
const listeners = new Set<() => void>();

export function getDiagnostics(): NotificationDiagnostics {
  return state;
}

export function updateDiagnostics(patch: Partial<NotificationDiagnostics>): void {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export function subscribeDiagnostics(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function recordIgnored(reason: IgnoreReason): void {
  updateDiagnostics({ lastIgnored: { reason, at: Date.now() } });
}

/** Disparado pelo botão "Testar aviso agora"; o NewMessageNotifier (sempre montado) mostra o contador no título. */
export const TEST_TITLE_EVENT = "imobflux:test-title";
