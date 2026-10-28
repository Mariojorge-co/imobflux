"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import {
  applyTitleCount,
  buildDesktopNotification,
  classifyConversation,
  classifyIncomingMessage,
  isAlreadyBeingRead,
  readNotificationPreferences,
  type IgnoreReason,
  type IncomingMessageRow,
  type NotifiableConversation,
} from "@/lib/notifications/model";
import { getDiagnostics, recordIgnored, TEST_TITLE_EVENT, updateDiagnostics } from "@/lib/notifications/diagnostics";
import { installAudioUnlock, playNotificationSound } from "@/lib/notifications/sound";
import { OPEN_CONVERSATION_MESSAGE, registerNotificationWorker, showSystemNotification } from "@/lib/notifications/system-notification";

export const NOTIFIED_EVENT = "imobflux:notified";
const TEST_TITLE_MS = 5_000;

function tabIsFocused(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}

/**
 * Avisos de mensagem nova, em qualquer tela do app: contador no título da aba, som opcional e aviso do sistema quando a aba
 * não está em foco. Só conta mensagem do cliente, recebida agora, de conversa que a pessoa enxerga (a RLS decide), aberta,
 * que não seja a conversa do número com ele mesmo, sem prazo desativado (a menos que a pessoa peça) e (grupo) liberada à equipe.
 * O título e o som NÃO dependem da permissão do navegador. Nada é enviado nem gravado: tudo fica neste navegador, e o painel de
 * diagnóstico das Preferências mostra só horários e o motivo do último aviso ignorado.
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

  // "Testar aviso agora": mostra o contador no título por alguns segundos, mesmo com a aba em foco.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onTest = () => {
      setCount((value) => value + 1);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setCount((value) => Math.max(0, value - 1)), TEST_TITLE_MS);
    };
    window.addEventListener(TEST_TITLE_EVENT, onTest);
    return () => {
      window.removeEventListener(TEST_TITLE_EVENT, onTest);
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Som: o navegador só libera o áudio depois de um toque/clique. Service worker: só exibe o aviso local e reabre a conversa.
  useEffect(() => {
    const removeUnlock = installAudioUnlock();
    void registerNotificationWorker();
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; path?: string } | null;
      if (data?.type === OPEN_CONVERSATION_MESSAGE && typeof data.path === "string" && data.path.startsWith("/")) router.push(data.path);
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => {
      removeUnlock();
      navigator.serviceWorker?.removeEventListener("message", onMessage);
    };
  }, [router]);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const ignore = (reason: IgnoreReason) => recordIgnored(reason);

    const handle = async (row: IncomingMessageRow) => {
      updateDiagnostics({ lastEventAt: Date.now() });
      const rowReason = classifyIncomingMessage(row);
      if (rowReason) return ignore(rowReason);
      const messageId = row.id as string;
      const conversationId = row.conversation_id as string;
      if (seenRef.current.has(messageId)) return;
      seenRef.current.add(messageId);
      if (seenRef.current.size > 500) seenRef.current = new Set([...seenRef.current].slice(-250));

      const focused = tabIsFocused();
      if (isAlreadyBeingRead(conversationId, { tabFocused: focused, openConversationId: openConversationRef.current })) return ignore("reading");

      // A função do banco roda como a pessoa logada: conversa que ela não enxerga volta nula.
      const { data, error } = await supabase.rpc("get_conversation_item", { p_conversation_id: conversationId });
      if (!active) return;
      if (error) return ignore("lookup_failed");
      const conversation = (data ?? null) as unknown as NotifiableConversation;
      const prefs = readNotificationPreferences(memberId);
      const conversationReason = classifyConversation(conversation, { includeDisabled: prefs.includeDisabled });
      if (conversationReason) return ignore(conversationReason);

      const stillFocused = tabIsFocused();
      if (!stillFocused) setCount((value) => value + 1);
      if (prefs.sound) void playNotificationSound(prefs.volume);

      let desktop = false;
      if (!stillFocused && prefs.desktop) {
        const content = buildDesktopNotification(conversation?.participant_name, row.text_content, prefs.hidePreview);
        const result = await showSystemNotification({
          title: content.title,
          body: content.body,
          tag: `conversa-${conversationId}`,
          conversationId,
          onOpen: (path) => router.push(path),
        });
        desktop = result === "ok";
      }
      updateDiagnostics({ lastNotifiedAt: Date.now() });
      window.dispatchEvent(new CustomEvent(NOTIFIED_EVENT, { detail: { conversationId, sound: prefs.sound, desktop } }));
    };

    const subscribe = async () => {
      if (!active) return;
      updateDiagnostics({ realtime: "connecting" });
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
          if (!active) return;
          if (status === "SUBSCRIBED") updateDiagnostics({ realtime: "connected" });
          else if (status === "CLOSED") updateDiagnostics({ realtime: "disconnected" });
          else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            updateDiagnostics({ realtime: "disconnected" });
            const failed = channel;
            retryTimer = setTimeout(() => {
              if (failed) void supabase.removeChannel(failed);
              void subscribe();
            }, 2_000);
          }
        });
    };
    void subscribe();

    // Celulares congelam a página em segundo plano e a conexão cai: ao voltar, refaz a assinatura se não estiver conectada.
    const reconnect = () => {
      if (document.visibilityState !== "visible" || !active || getDiagnostics().realtime === "connected") return;
      const stale = channel;
      if (stale) void supabase.removeChannel(stale);
      void subscribe();
    };
    document.addEventListener("visibilitychange", reconnect);
    window.addEventListener("online", reconnect);

    return () => {
      active = false;
      document.removeEventListener("visibilitychange", reconnect);
      window.removeEventListener("online", reconnect);
      if (retryTimer) clearTimeout(retryTimer);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [memberId, router]);

  return null;
}
