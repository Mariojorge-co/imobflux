"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import {
  applyTitleCount,
  buildDesktopNotification,
  isAlreadyBeingRead,
  isFreshIncomingMessage,
  isNotifiableConversation,
  readNotificationPreferences,
  type IncomingMessageRow,
  type NotifiableConversation,
} from "@/lib/notifications/model";

export const NOTIFIED_EVENT = "imobflux:notified";

function tabIsFocused(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}

/** Som curto gerado na hora (sem arquivo de áudio). Qualquer falha (navegador bloqueou o áudio) é ignorada. */
export function playNotificationSound(volume: number): void {
  try {
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    const audio = new Context();
    const gain = audio.createGain();
    gain.gain.value = Math.min(1, Math.max(0, volume)) * 0.4;
    gain.connect(audio.destination);
    const now = audio.currentTime;
    [660, 880].forEach((frequency, index) => {
      const oscillator = audio.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      oscillator.start(now + index * 0.12);
      oscillator.stop(now + index * 0.12 + 0.1);
    });
    window.setTimeout(() => void audio.close().catch(() => undefined), 600);
  } catch {
    // sem áudio: o aviso visual continua valendo
  }
}

/**
 * Avisos de mensagem nova, em qualquer tela do app: contador no título da aba, som opcional e aviso do sistema quando a aba
 * não está em foco. Só conta mensagem do cliente, recebida agora, de conversa que a pessoa enxerga (a RLS decide), aberta,
 * sem prazo pausado/desativado e (grupo) liberada à equipe. Nada é enviado nem gravado: tudo fica neste navegador.
 */
export function NewMessageNotifier({ memberId }: { memberId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [count, setCount] = useState(0);
  const countRef = useRef(0);
  const openConversationRef = useRef<string | null>(null);
  const seenRef = useRef(new Set<string>());

  useEffect(() => {
    const match = /^\/conversas\/([^/?#]+)/.exec(pathname ?? "");
    openConversationRef.current = match ? match[1] : null;
  }, [pathname]);

  // Contador no título: reaplica quando a página troca o título (o Next reescreve a cada rota).
  useEffect(() => {
    countRef.current = count;
    const apply = () => {
      const next = applyTitleCount(document.title, countRef.current);
      if (next !== document.title) document.title = next;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [count]);

  // Voltou para a aba: zera o contador.
  useEffect(() => {
    const clear = () => {
      if (tabIsFocused() && countRef.current > 0) setCount(0);
    };
    window.addEventListener("focus", clear);
    document.addEventListener("visibilitychange", clear);
    return () => {
      window.removeEventListener("focus", clear);
      document.removeEventListener("visibilitychange", clear);
    };
  }, []);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const handle = async (row: IncomingMessageRow) => {
      if (!isFreshIncomingMessage(row)) return;
      const messageId = row.id as string;
      const conversationId = row.conversation_id as string;
      if (seenRef.current.has(messageId)) return;
      seenRef.current.add(messageId);
      if (seenRef.current.size > 500) seenRef.current = new Set([...seenRef.current].slice(-250));

      const focused = tabIsFocused();
      if (isAlreadyBeingRead(conversationId, { tabFocused: focused, openConversationId: openConversationRef.current })) return;

      // A função do banco roda como a pessoa logada: conversa que ela não enxerga volta nula.
      const { data } = await supabase.rpc("get_conversation_item", { p_conversation_id: conversationId });
      if (!active) return;
      const conversation = (data ?? null) as unknown as NotifiableConversation;
      if (!isNotifiableConversation(conversation)) return;

      const prefs = readNotificationPreferences(memberId);
      const stillFocused = tabIsFocused();
      if (!stillFocused) setCount((value) => value + 1);
      if (prefs.sound) playNotificationSound(prefs.volume);

      let desktop = false;
      if (!stillFocused && prefs.desktop && typeof Notification !== "undefined" && Notification.permission === "granted") {
        const content = buildDesktopNotification(conversation?.participant_name, row.text_content, prefs.hidePreview);
        try {
          const notification = new Notification(content.title, { body: content.body, tag: `conversa-${conversationId}` });
          notification.onclick = () => {
            window.focus();
            router.push(`/conversas/${conversationId}`);
            notification.close();
          };
          desktop = true;
        } catch {
          // alguns navegadores móveis só aceitam aviso pelo service worker: o contador do título continua
        }
      }
      window.dispatchEvent(new CustomEvent(NOTIFIED_EVENT, { detail: { conversationId, sound: prefs.sound, desktop } }));
    };

    const subscribe = async () => {
      if (!active) return;
      // O canal precisa nascer já com a sessão: sem o token, o servidor do tempo real recusa (401) e nenhum aviso chega.
      const { data: session } = await supabase.auth.getSession();
      if (!active) return;
      if (session.session?.access_token) await supabase.realtime.setAuth(session.session.access_token);
      if (!active) return;
      channel = supabase
        .channel(`new-message-notifier-${crypto.randomUUID()}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
          void handle(payload.new as IncomingMessageRow);
        })
        .subscribe((status) => {
          if ((status === "CHANNEL_ERROR" || status === "TIMED_OUT") && active) {
            const failed = channel;
            retryTimer = setTimeout(() => {
              if (failed) void supabase.removeChannel(failed);
              void subscribe();
            }, 2_000);
          }
        });
    };
    void subscribe();

    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [memberId, router]);

  return null;
}
