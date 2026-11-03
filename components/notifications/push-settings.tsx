"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, Smartphone, Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import { detectPlatform } from "@/lib/notifications/device";
import { registerNotificationWorker } from "@/lib/notifications/system-notification";
import {
  INSTALL_STEPS_IOS,
  decidePushState,
  describeDevice,
  reenableSteps,
  urlBase64ToUint8Array,
  type PushCapabilities,
  type PushUiState,
} from "@/lib/push/devices";

type Device = {
  id: string;
  platform: string;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  lastErrorAt: string | null;
  disabled: boolean;
  includeSlaDisabled: boolean;
  endpointTail: string;
};

type Props = {
  /** Chave pública VAPID (nula quando o servidor não está configurado). */
  publicKey: string | null;
};

const JSON_HEADERS = { "Content-Type": "application/json" };

function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    return registration ? await registration.pushManager.getSubscription() : null;
  } catch {
    return null;
  }
}

async function readCapabilities(configured: boolean): Promise<PushCapabilities> {
  const subscription = await currentSubscription();
  return {
    configured,
    platform: detectPlatform(navigator.userAgent, navigator.maxTouchPoints),
    installed: isStandalone(),
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: "PushManager" in window,
    hasNotification: typeof Notification !== "undefined",
    permission: typeof Notification === "undefined" ? "unsupported" : Notification.permission,
    subscribed: subscription !== null,
  };
}

const STATE_TEXT: Record<Exclude<PushUiState, "checking" | "needs-install" | "denied">, string> = {
  unavailable: "Os avisos com o app fechado ainda não estão disponíveis neste ImobFlux (falta a configuração do servidor). Os avisos com o app aberto continuam funcionando.",
  unsupported: "Este navegador não oferece avisos com o app fechado. Use o Chrome (Android ou computador) ou, no iPhone, o ImobFlux instalado na Tela de Início.",
  inactive: "Ative para receber um aviso no aparelho mesmo com o ImobFlux fechado.",
  active: "Ativo neste aparelho: você recebe um aviso mesmo com o ImobFlux fechado.",
};

/** Seção "Avisos neste aparelho": avisos do servidor (Web Push) com o app fechado. A permissão só é pedida num toque. */
export function PushSettings({ publicKey }: Props) {
  const configured = publicKey !== null;
  const [state, setState] = useState<PushUiState>("checking");
  const [capabilities, setCapabilities] = useState<PushCapabilities | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [currentEndpoint, setCurrentEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const next = await readCapabilities(configured);
    setCapabilities(next);
    setState(decidePushState(next));
    const subscription = await currentSubscription();
    setCurrentEndpoint(subscription?.endpoint ?? null);
    if (!configured) return;
    try {
      const response = await fetch("/api/push/subscriptions", { cache: "no-store" });
      if (response.ok) setDevices(((await response.json()) as { devices: Device[] }).devices);
    } catch {
      // sem rede: a lista aparece quando voltar
    }
  }, [configured]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Se este aparelho já tem assinatura no navegador, confirma no servidor (idempotente): cobre o caso de ela ter sido desativada ou trocada.
      const subscription = await currentSubscription();
      if (configured && subscription && Notification.permission === "granted") {
        try {
          await fetch("/api/push/subscriptions", {
            method: "POST",
            headers: JSON_HEADERS,
            body: JSON.stringify({ ...subscription.toJSON(), platform: detectPlatform(navigator.userAgent, navigator.maxTouchPoints) }),
          });
        } catch {
          // segue sem confirmar
        }
      }
      if (!cancelled) await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [configured, refresh]);

  const enable = async () => {
    if (!publicKey || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      // 1º passo, ainda dentro do toque: pedir a permissão.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMessage({ tone: "error", text: permission === "denied" ? "A permissão foi negada. Veja abaixo como liberar." : "Você não liberou os avisos." });
        return;
      }
      const registration = await registerNotificationWorker();
      if (!registration) throw new Error("worker");
      const ready = await navigator.serviceWorker.ready;
      const key = urlBase64ToUint8Array(publicKey);
      let subscription = await ready.pushManager.getSubscription();
      try {
        subscription ??= await ready.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      } catch {
        // chave diferente da anterior: recomeça do zero
        await subscription?.unsubscribe();
        subscription = await ready.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      }
      const response = await fetch("/api/push/subscriptions", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ ...subscription.toJSON(), platform: detectPlatform(navigator.userAgent, navigator.maxTouchPoints) }),
      });
      if (!response.ok) throw new Error("server");
      setMessage({ tone: "ok", text: "Avisos ativados neste aparelho." });
    } catch {
      setMessage({ tone: "error", text: "Não foi possível ativar os avisos agora. Tente de novo em instantes." });
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const removeDevice = async (device: Device) => {
    setBusy(true);
    setMessage(null);
    try {
      const subscription = await currentSubscription();
      const isThis = subscription !== null && subscription.endpoint.endsWith(device.endpointTail);
      const response = await fetch("/api/push/subscriptions", { method: "DELETE", headers: JSON_HEADERS, body: JSON.stringify({ id: device.id }) });
      if (!response.ok) throw new Error("server");
      if (isThis) await subscription.unsubscribe();
      setMessage({ tone: "ok", text: isThis ? "Avisos desligados neste aparelho." : "Aparelho removido." });
    } catch {
      setMessage({ tone: "error", text: "Não foi possível remover agora." });
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const sendTest = async (delaySeconds: 0 | 10) => {
    if (!currentEndpoint) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/push/test", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ endpoint: currentEndpoint, delaySeconds }) });
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (response.status === 202) {
        setMessage({ tone: "ok", text: `Teste agendado: o aviso chega em cerca de ${delaySeconds} segundos, mesmo com o app fechado.` });
      } else if (response.ok) {
        setMessage({ tone: "ok", text: "Aviso de teste enviado. Ele deve aparecer em instantes." });
      } else if (response.status === 429) {
        setMessage({ tone: "error", text: result?.error ?? "Aguarde alguns segundos antes de pedir outro teste." });
      } else {
        setMessage({ tone: "error", text: "O aviso de teste não saiu. Se continuar, desative e ative de novo neste aparelho." });
      }
    } catch {
      setMessage({ tone: "error", text: "Sem conexão para enviar o teste." });
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const toggleSlaDisabled = async (device: Device, includeSlaDisabled: boolean) => {
    setDevices((list) => list.map((item) => (item.id === device.id ? { ...item, includeSlaDisabled } : item)));
    try {
      await fetch("/api/push/subscriptions", { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ id: device.id, includeSlaDisabled }) });
    } finally {
      await refresh();
    }
  };

  const thisDevice = devices.find((device) => currentEndpoint !== null && currentEndpoint.endsWith(device.endpointTail));

  return (
    <div className="space-y-4" data-push-state={state} data-testid="push-settings">
      <p className="text-body text-text-muted">
        Receba um aviso no aparelho quando chegar mensagem de cliente, mesmo com o ImobFlux fechado. Você é avisado das conversas em que é o
        responsável; as conversas sem responsável avisam só o proprietário. O aviso mostra só o nome do contato: nunca o texto da mensagem.
      </p>

      {state === "checking" ? (
        <p className="text-body text-text-muted" data-testid="push-status">
          Verificando este aparelho…
        </p>
      ) : null}

      {state === "needs-install" ? (
        <div className="space-y-2 rounded-control border border-border bg-neutral-soft/40 p-3" data-testid="push-install-help">
          <p className="text-body font-medium text-text">No iPhone, instale o ImobFlux na Tela de Início para receber avisos.</p>
          <ol className="list-decimal space-y-1 pl-5 text-body text-text-muted">
            {INSTALL_STEPS_IOS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="text-caption text-text-muted">Precisa do iOS 16.4 ou mais novo. Instale pelo Safari (outros navegadores podem não oferecer essa opção).</p>
        </div>
      ) : null}

      {state === "denied" && capabilities ? (
        <div className="space-y-1 rounded-control border border-border bg-neutral-soft/40 p-3" data-testid="push-denied-help">
          <p className="text-body font-medium text-text">Os avisos estão bloqueados neste aparelho.</p>
          <p className="text-body text-text-muted">{reenableSteps(capabilities.platform, capabilities.installed)}</p>
        </div>
      ) : null}

      {state !== "checking" && state !== "needs-install" && state !== "denied" ? (
        <p className="text-body text-text-muted" data-testid="push-status">
          {STATE_TEXT[state]}
        </p>
      ) : null}

      {state === "inactive" ? (
        <Button data-testid="push-enable" disabled={busy} onClick={() => void enable()} type="button">
          <BellRing aria-hidden="true" size={18} /> Ativar avisos neste aparelho
        </Button>
      ) : null}

      {state === "active" ? (
        <div className="flex flex-wrap gap-2">
          <Button data-testid="push-test" disabled={busy} onClick={() => void sendTest(0)} type="button" variant="secondary">
            Enviar aviso de teste
          </Button>
          <Button data-testid="push-test-delayed" disabled={busy} onClick={() => void sendTest(10)} type="button" variant="secondary">
            Enviar aviso de teste em 10 segundos
          </Button>
          {thisDevice ? (
            <Button data-testid="push-disable" disabled={busy} onClick={() => void removeDevice(thisDevice)} type="button" variant="ghost">
              Desativar neste aparelho
            </Button>
          ) : null}
        </div>
      ) : null}

      {state === "active" ? (
        <p className="text-caption text-text-muted" data-testid="push-test-help">
          O aviso chega em cerca de 10 segundos. Feche o app e bloqueie a tela agora.
        </p>
      ) : null}

      {message ? (
        <p className={message.tone === "ok" ? "text-body text-success" : "text-body text-danger"} data-testid="push-message" role="status">
          {message.text}
        </p>
      ) : null}

      {thisDevice ? (
        <label className="flex min-h-11 items-start gap-3 text-body text-text">
          <input
            checked={thisDevice.includeSlaDisabled}
            className="mt-1 size-4 shrink-0 accent-primary"
            data-testid="push-include-disabled"
            onChange={(event) => void toggleSlaDisabled(thisDevice, event.target.checked)}
            type="checkbox"
          />
          <span>
            Avisar também as conversas com o prazo desativado
            <span className="block text-caption text-text-muted">Por padrão elas ficam em silêncio, como nos avisos com o app aberto.</span>
          </span>
        </label>
      ) : null}

      {devices.length > 0 ? (
        <div className="space-y-2" data-testid="push-devices">
          <p className="text-caption font-semibold uppercase tracking-wide text-text-muted">Seus aparelhos com aviso</p>
          <ul className="divide-y divide-border rounded-control border border-border">
            {devices.map((device) => {
              const isThis = currentEndpoint !== null && currentEndpoint.endsWith(device.endpointTail);
              return (
                <li className="flex min-h-11 items-center gap-3 px-3 py-2" data-testid="push-device" key={device.id}>
                  <Smartphone aria-hidden="true" className="shrink-0 text-text-muted" size={18} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-medium text-text">
                      {describeDevice(device.platform, device.userAgent)}
                    </p>
                    <p className="truncate text-caption text-text-muted">
                      {isThis ? "Este aparelho · " : ""}
                      {device.disabled ? "desativado pelo serviço de aviso: ative de novo" : `ativo desde ${new Date(device.createdAt).toLocaleDateString("pt-BR")}`}
                    </p>
                  </div>
                  <Button
                    aria-label={`Remover ${describeDevice(device.platform, device.userAgent)}`}
                    disabled={busy}
                    onClick={() => void removeDevice(device)}
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 aria-hidden="true" size={18} />
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
