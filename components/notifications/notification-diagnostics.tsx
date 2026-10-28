"use client";

import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui";
import {
  getDiagnostics,
  subscribeDiagnostics,
  TEST_TITLE_EVENT,
  updateDiagnostics,
  type ChannelResult,
  type RealtimeStatus,
} from "@/lib/notifications/diagnostics";
import { DEVICE_GUIDES, detectDeviceSupport, deviceSummary } from "@/lib/notifications/device";
import { IGNORE_REASON_TEXT, readNotificationPreferences } from "@/lib/notifications/model";
import { getAudioStatus, playNotificationSound, subscribeAudioStatus, unlockAudio } from "@/lib/notifications/sound";
import { notificationPermission, showSystemNotification } from "@/lib/notifications/system-notification";

const REALTIME_TEXT: Record<RealtimeStatus, string> = {
  connecting: "conectando…",
  connected: "conectada",
  disconnected: "desconectada (tentando reconectar)",
};

const PERMISSION_LABEL = { granted: "concedida", denied: "negada", default: "ainda não pedida", unsupported: "sem suporte neste navegador" } as const;

const RESULT_TEXT: Record<ChannelResult, string> = {
  ok: "ok",
  blocked: "bloqueado pelo navegador (toque na tela e tente de novo)",
  denied: "sem permissão do navegador",
  unsupported: "sem suporte neste aparelho",
  error: "falhou",
};

function formatTime(timestamp: number | null): string {
  if (!timestamp) return "nenhum ainda";
  return new Date(timestamp).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function useDevice() {
  return useSyncExternalStore(
    () => () => undefined,
    () => {
      const standalone =
        window.matchMedia?.("(display-mode: standalone)").matches === true ||
        (navigator as unknown as { standalone?: boolean }).standalone === true;
      return `${detectDeviceSupport(navigator.userAgent, navigator.maxTouchPoints, standalone).platform}|${standalone}`;
    },
    () => "desktop|false",
  );
}

/** Botão "Testar aviso agora", painel de diagnóstico simples e o que funciona em cada aparelho. Sem texto de mensagem. */
export function NotificationDiagnostics({ memberId }: { memberId: string }) {
  const diagnostics = useSyncExternalStore(subscribeDiagnostics, getDiagnostics, getDiagnostics);
  const audio = useSyncExternalStore(subscribeAudioStatus, getAudioStatus, () => "locked" as const);
  const permission = useSyncExternalStore(
    (onChange) => {
      const timer = window.setInterval(onChange, 1500);
      return () => window.clearInterval(timer);
    },
    notificationPermission,
    () => "default" as const,
  );
  const [platform, installed] = useDevice().split("|") as ["ios" | "android" | "desktop", string];
  const [testing, setTesting] = useState(false);

  const runTest = async () => {
    setTesting(true);
    // O clique é um gesto da pessoa: libera o áudio e (se ainda não decidiu) pode pedir a permissão.
    await unlockAudio();
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      try {
        await Notification.requestPermission();
      } catch {
        // segue sem permissão
      }
    }
    const prefs = readNotificationPreferences(memberId);
    window.dispatchEvent(new Event(TEST_TITLE_EVENT));
    const sound = await playNotificationSound(prefs.volume);
    const system = await showSystemNotification({ title: "ImobFlux", body: "Este é um aviso de teste.", tag: "imobflux-teste" });
    updateDiagnostics({ lastTest: { at: Date.now(), title: "ok", sound: sound === "played" ? "ok" : sound, system } });
    setTesting(false);
  };

  const test = diagnostics.lastTest;
  const rows: Array<[string, string, string]> = [
    ["Permissão do navegador", PERMISSION_LABEL[permission], "diag-permission"],
    ["Áudio", audio === "unlocked" ? "liberado" : audio === "unsupported" ? "sem suporte" : "ainda bloqueado: toque ou clique em qualquer lugar da tela para liberar", "diag-audio"],
    ["Conexão em tempo real", REALTIME_TEXT[diagnostics.realtime], "diag-realtime"],
    ["Último evento recebido", formatTime(diagnostics.lastEventAt), "diag-last-event"],
    ["Último aviso dado", formatTime(diagnostics.lastNotifiedAt), "diag-last-notified"],
    [
      "Último aviso ignorado",
      diagnostics.lastIgnored ? `${IGNORE_REASON_TEXT[diagnostics.lastIgnored.reason]} (${formatTime(diagnostics.lastIgnored.at)})` : "nenhum ainda",
      "diag-last-ignored",
    ],
  ];

  return (
    <div className="space-y-4" data-testid="notification-diagnostics">
      <div className="flex flex-wrap items-center gap-3">
        <Button data-testid="notif-test" disabled={testing} onClick={() => void runTest()} type="button" variant="secondary">
          Testar aviso agora
        </Button>
        <p className="text-caption text-text-muted" data-testid="notif-test-result" role="status">
          {test
            ? `Teste das ${formatTime(test.at)}: título ${RESULT_TEXT[test.title]}; som ${RESULT_TEXT[test.sound]}; aviso do sistema ${RESULT_TEXT[test.system]}.`
            : "Dispara o número no título, o som e o aviso do sistema, agora, só neste aparelho."}
        </p>
      </div>

      <dl className="grid gap-x-4 gap-y-2 text-body sm:grid-cols-[14rem_1fr]" data-testid="notif-diagnostics-list">
        {rows.map(([label, value, testId]) => (
          <div className="contents" key={testId}>
            <dt className="text-text-muted">{label}</dt>
            <dd className="text-text" data-testid={testId}>{value}</dd>
          </div>
        ))}
      </dl>

      {platform === "ios" ? (
        <div className="rounded-control border border-border bg-neutral-soft px-3 py-2 text-caption text-text" data-testid="ios-notice" role="note">
          <p className="font-medium">No iPhone, o que vale hoje</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            <li>Aviso do sistema e som <strong>não funcionam</strong> com o ImobFlux aberto no navegador (Safari, Opera ou outro) quando você sai da página ou bloqueia a tela.</li>
            <li>Título com o número e som funcionam <strong>só com a página aberta e em primeiro plano</strong>.</li>
            <li>Só o app instalado na tela inicial pode receber avisos, e isso exige Web Push com servidor, que ainda não está pronto.</li>
          </ul>
        </div>
      ) : null}

      <div className="space-y-2" data-testid="install-help">
        <p className="text-body font-medium text-text">Como instalar no iPhone</p>
        <ol className="list-decimal space-y-1 pl-5 text-caption text-text-muted">
          <li>Abra o ImobFlux no navegador do iPhone.</li>
          <li>Toque em <strong>Compartilhar</strong> (o quadrado com a seta para cima).</li>
          <li>Escolha <strong>Adicionar à Tela de Início</strong> e confirme.</li>
        </ol>
        <p className="text-caption text-text-muted">
          O app instalado abre em tela cheia, sem as barras do navegador. Instalar não liga os avisos por si só. Se o Opera não mostrar essa opção, abra o ImobFlux no Safari para instalar.
        </p>
      </div>

      <div className="space-y-2" data-testid="notif-device-guide">
        <p className="text-body font-medium text-text">O que funciona em cada aparelho</p>
        <p className="text-caption text-text-muted" data-testid="notif-device-summary">
          {deviceSummary({ platform, installed: installed === "true" })}
        </p>
        <ul className="space-y-2">
          {DEVICE_GUIDES.map((guide) => (
            <li
              className={`rounded-control border px-3 py-2 text-caption ${guide.platform === platform ? "border-primary bg-primary-soft text-text" : "border-border text-text-muted"}`}
              data-current={guide.platform === platform}
              key={guide.platform}
            >
              <span className="block font-medium text-text">
                {guide.label}
                {guide.platform === platform ? " — seu aparelho" : ""}
              </span>
              <span className="block">Funciona: {guide.works}</span>
              <span className="block">Não funciona: {guide.limits}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
