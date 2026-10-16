"use client";

import { useCallback, useSyncExternalStore } from "react";
import { Bell, Volume2 } from "lucide-react";
import { Button } from "@/components/ui";
import { playNotificationSound } from "@/components/notifications/new-message-notifier";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_PREFS_EVENT,
  notificationPrefsKey,
  parseNotificationPreferences,
  saveNotificationPreferences,
  type NotificationPreferences,
} from "@/lib/notifications/model";

function subscribe(onChange: () => void) {
  window.addEventListener(NOTIFICATION_PREFS_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(NOTIFICATION_PREFS_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

type PermissionState = NotificationPermission | "unsupported";

function readPermission(): PermissionState {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

const PERMISSION_TEXT: Record<PermissionState, string> = {
  granted: "O navegador permite avisos.",
  denied: "O navegador bloqueou os avisos. Libere nas configurações do site para ativar.",
  default: "O navegador vai pedir sua permissão ao ativar.",
  unsupported: "Este navegador não oferece avisos do sistema.",
};

const rowClass = "flex min-h-11 items-start gap-3 text-body text-text";
const checkClass = "mt-1 size-4 shrink-0 accent-primary";

/** Escolhas pessoais de aviso de mensagem nova (neste navegador). */
export function NotificationSettings({ memberId }: { memberId: string }) {
  // O valor guardado vem do navegador; no servidor vale o padrão. Comparar a string crua mantém o snapshot estável.
  const raw = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return window.localStorage.getItem(notificationPrefsKey(memberId)) ?? "";
      } catch {
        return "";
      }
    },
    () => "",
  );
  const prefs: NotificationPreferences = raw ? parseNotificationPreferences(raw) : DEFAULT_NOTIFICATION_PREFERENCES;
  // A permissão vem do navegador; no servidor vale "default" (evita diferença na hidratação). Reavaliada quando as preferências mudam.
  const permission = useSyncExternalStore(subscribe, readPermission, () => "default" as PermissionState);

  const update = useCallback((patch: Partial<NotificationPreferences>) => saveNotificationPreferences(memberId, { ...prefs, ...patch }), [memberId, prefs]);

  const toggleDesktop = async (enabled: boolean) => {
    if (!enabled) return update({ desktop: false });
    if (typeof Notification === "undefined") return;
    let result: NotificationPermission = Notification.permission;
    if (result === "default") {
      try {
        result = await Notification.requestPermission();
      } catch {
        result = Notification.permission;
      }
    }
    update({ desktop: result === "granted" });
  };

  return (
    <div className="space-y-4" data-testid="notification-settings">
      <p className="text-body text-text-muted">
        O número de mensagens novas aparece sempre no título da aba. Aqui você escolhe o que mais avisar.
      </p>

      <label className={rowClass}>
        <input
          checked={prefs.sound}
          className={checkClass}
          data-testid="notif-sound"
          onChange={(event) => update({ sound: event.target.checked })}
          type="checkbox"
        />
        <span>Tocar um som quando chegar mensagem nova</span>
      </label>

      <div className="flex items-center gap-3 pl-7">
        <Volume2 aria-hidden="true" className="shrink-0 text-text-muted" size={18} />
        <input
          aria-label="Volume do som"
          className="h-11 w-full max-w-60 accent-primary"
          data-testid="notif-volume"
          disabled={!prefs.sound}
          max={100}
          min={0}
          onChange={(event) => update({ volume: Number(event.target.value) / 100 })}
          type="range"
          value={Math.round(prefs.volume * 100)}
        />
        <Button
          disabled={!prefs.sound}
          onClick={() => playNotificationSound(prefs.volume)}
          type="button"
          variant="secondary"
        >
          Testar
        </Button>
      </div>

      <label className={rowClass}>
        <input
          checked={prefs.desktop}
          className={checkClass}
          data-testid="notif-desktop"
          disabled={permission === "unsupported" || permission === "denied"}
          onChange={(event) => void toggleDesktop(event.target.checked)}
          type="checkbox"
        />
        <span>
          <span className="inline-flex items-center gap-1.5">
            <Bell aria-hidden="true" size={16} /> Aviso do sistema quando a aba não estiver em foco
          </span>
          <span className="block text-caption text-text-muted" data-testid="notif-permission">
            {PERMISSION_TEXT[permission]}
          </span>
        </span>
      </label>

      <label className={rowClass}>
        <input
          checked={prefs.hidePreview}
          className={checkClass}
          data-testid="notif-hide-preview"
          onChange={(event) => update({ hidePreview: event.target.checked })}
          type="checkbox"
        />
        <span>
          Esconder o nome e o texto no aviso do sistema
          <span className="block text-caption text-text-muted">O aviso mostra só “nova mensagem”, útil se outras pessoas veem sua tela.</span>
        </span>
      </label>
    </div>
  );
}
