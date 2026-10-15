"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { FileText, Maximize2, MessageSquare, Minimize2, Paperclip, Send, Zap } from "lucide-react";
import { OutgoingFilesTray } from "@/components/conversations/outgoing-files-tray";
import type { OutgoingFiles } from "@/components/conversations/use-outgoing-files";
import { ACCEPT_ATTRIBUTE } from "@/lib/conversations/outgoing-files";
import { ConfirmDialog } from "@/components/quick-replies/confirm-dialog";
import { QuickRepliesPanel } from "@/components/quick-replies/quick-replies-panel";
import { SlashMenu, slashOptionId } from "@/components/quick-replies/slash-menu";
import { useQuickReplies } from "@/components/quick-replies/use-quick-replies";
import { composerHeight } from "@/lib/quick-replies/composer-size";
import { searchForSlash } from "@/lib/quick-replies/filter";
import { detectSlashTrigger, insertAtCursor, replaceSlashTrigger, type SlashTrigger } from "@/lib/quick-replies/insert";
import type { QuickReply } from "@/lib/quick-replies/types";
import { findUnresolvedVariables, resolveVariables, unresolvedWarning } from "@/lib/quick-replies/variables";
import { saveInternalNoteAction } from "@/lib/conversations/actions";
import { sendMediaQueued, sendTextQueued } from "@/lib/conversations/send-client";
import type {
  ConversationContextData,
  ConversationMessage,
} from "@/lib/conversations/data";

const MAX_CHAR_LIMIT = 4096;
const COUNTER_SHOW_THRESHOLD = 3500;

type MessageFormProps = {
  conversationId: string;
  /** Nome do contato na conversa: preenche {{nome}} e {{nome_completo}} nas respostas rápidas. */
  contactName?: string | null;
  opportunityId?: string | null;
  onInternalNoteSaved?: (
    note: ConversationContextData["notes"][number],
    opportunityId: string | null,
  ) => void;
  onMessagePersisted?: (message: ConversationMessage) => void;
  /** Bolha provisória ("enviando…") assim que o usuário envia, antes de o servidor responder. */
  onMessageSending?: (message: ConversationMessage) => void;
  /** Fim do envio: remove a bolha provisória e, se deu certo, entrega a mensagem gravada. */
  onMessageSettled?: (pendingId: string, persisted?: ConversationMessage) => void;
  /** Falha do envio: a bolha fica "não enviada" com o motivo e a opção de tentar de novo. */
  onMessageFailed?: (pendingId: string, reason: string, code?: string, persisted?: ConversationMessage) => void;
  /** Arquivos escolhidos (clipe, arrastar, colar): bandeja, upload e envio. */
  outgoing: OutgoingFiles;
  /** Arquivos só em conversa individual (grupos: sem envio de arquivos). */
  filesEnabled?: boolean;
};

export function MessageForm({
  conversationId,
  contactName,
  opportunityId,
  onInternalNoteSaved,
  onMessagePersisted,
  onMessageSending,
  onMessageSettled,
  onMessageFailed,
  outgoing,
  filesEnabled = true,
}: MessageFormProps) {
  const [activeTab, setActiveTab] = useState<"message" | "note">("message");
  const [text, setText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Respostas rápidas: painel, atalho "/", caixa expandida e confirmação de campos em branco.
  const quick = useQuickReplies();
  const [panelOpen, setPanelOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [slash, setSlash] = useState<SlashTrigger | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [unresolved, setUnresolved] = useState<string[] | null>(null);
  const selectionRef = useRef<{ start: number; end: number } | null>(null);
  const dismissedSlashRef = useRef<number | null>(null);
  const pendingCaretRef = useRef<number | null>(null);

  const reactId = useId();
  const inputId = typeof reactId === "string" ? reactId : "input-message-text";

  // A caixa começa com 1 linha e cresce com o texto até ~40% da altura da tela (depois rola por dentro). "Expandir" leva a
  // ~60%. Uma resposta longa inserida nunca fica cortada: a altura acompanha o conteúdo.
  const resizeTextarea = useCallback(() => {
    const element = textareaRef.current;
    if (!element) return;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    element.style.height = "auto";
    const borders = element.offsetHeight - element.clientHeight;
    const size = composerHeight(element.scrollHeight + borders, viewportHeight, expanded);
    element.style.height = `${size.height}px`;
    element.style.overflowY = size.scrolls ? "auto" : "hidden";
  }, [expanded]);

  useEffect(() => {
    resizeTextarea();
  }, [resizeTextarea, text, activeTab]);

  useEffect(() => {
    window.addEventListener("resize", resizeTextarea);
    window.visualViewport?.addEventListener("resize", resizeTextarea);
    return () => {
      window.removeEventListener("resize", resizeTextarea);
      window.visualViewport?.removeEventListener("resize", resizeTextarea);
    };
  }, [resizeTextarea]);

  // Depois de inserir uma resposta: cursor no fim do trecho inserido e foco de volta na caixa.
  useEffect(() => {
    const caret = pendingCaretRef.current;
    if (caret === null) return;
    pendingCaretRef.current = null;
    const timer = window.setTimeout(() => {
      const element = textareaRef.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(caret, caret);
      selectionRef.current = { start: caret, end: caret };
      element.scrollTop = element.scrollHeight;
    }, 0);
    return () => window.clearTimeout(timer);
  }, [text]);

  // Atalho "/": acompanha o cursor. Esc dispensa a lista até a barra sair de cena.
  const syncSlash = useCallback(
    (value: string, caret: number) => {
      const trigger = detectSlashTrigger(value, caret);
      if (!trigger) {
        dismissedSlashRef.current = null;
        setSlash(null);
        return;
      }
      if (dismissedSlashRef.current === trigger.start) {
        setSlash(null);
        return;
      }
      dismissedSlashRef.current = null;
      quick.ensureLoaded();
      setSlash((previous) => {
        if (!previous || previous.query !== trigger.query) setSlashIndex(0);
        return trigger;
      });
    },
    [quick],
  );

  const handleTextChange = (newText: string, caret?: number) => {
    setText(newText);
    if (feedback) {
      setFeedback(null);
    }
    if (caret !== undefined) {
      selectionRef.current = { start: caret, end: caret };
      syncSlash(newText, caret);
    }
  };

  const slashResults = useMemo(
    () => (slash && quick.library ? searchForSlash(quick.library.replies, slash.query) : []),
    [slash, quick.library],
  );
  const slashOpen = slash !== null;
  const slashMenuId = `${inputId}-slash`;

  // Insere a resposta na caixa (NUNCA envia): variáveis resolvidas, texto editável, cursor no fim do trecho inserido.
  const insertQuickReply = (reply: QuickReply, via: "panel" | "slash") => {
    const resolved = resolveVariables(reply.body, {
      contactName,
      memberName: quick.library?.memberName,
      workspaceName: quick.library?.workspaceName,
    });
    const result =
      via === "slash" && slash
        ? replaceSlashTrigger(text, slash, resolved, MAX_CHAR_LIMIT)
        : insertAtCursor(text, selectionRef.current?.start, selectionRef.current?.end, resolved, MAX_CHAR_LIMIT);
    setPanelOpen(false);
    setSlash(null);
    dismissedSlashRef.current = null;
    if (!result) {
      setFeedback({
        type: "error",
        message: `Esta resposta não cabe aqui: o texto passaria do limite de ${MAX_CHAR_LIMIT} caracteres. Apague um trecho e tente de novo.`,
      });
      window.setTimeout(() => textareaRef.current?.focus(), 0);
      return;
    }
    pendingCaretRef.current = result.caret;
    setText(result.value);
    setFeedback(null);
    quick.recordUse(reply.id);
  };

  const handleSubmit = async (options?: { skipConfirm?: boolean }) => {
    const trimmed = text.trim();
    const hasFiles = activeTab === "message" && outgoing.readyCount > 0;
    if (!trimmed && !hasFiles) return;

    if (activeTab === "message" && outgoing.uploading) {
      setFeedback({ type: "info", message: "Aguarde o envio dos arquivos terminar para enviar." });
      return;
    }

    if (trimmed.length > MAX_CHAR_LIMIT) {
      setFeedback({
        type: "error",
        message: `O texto excede o limite máximo de ${MAX_CHAR_LIMIT} caracteres.`,
      });
      return;
    }

    if (activeTab === "message") {
      // Mensagem com {{campo}} ainda aberto: pede confirmação antes de enviar ao cliente.
      if (trimmed && !options?.skipConfirm) {
        const pendingFields = findUnresolvedVariables(trimmed);
        if (pendingFields.length > 0) {
          setUnresolved(pendingFields);
          return;
        }
      }

      // Envio sem travar a caixa: a bolha "enviando…" aparece na hora, a caixa é limpa e liberada, e o envio entra na
      // fila da conversa (um de cada vez, na ordem). Se falhar, a bolha vira "não enviada" com o motivo e "Tentar de
      // novo"; o texto não volta para a caixa e nada é reenviado sozinho.
      setFeedback(null);
      setText("");
      const handlers = {
        onSending: (pending: ConversationMessage) => onMessageSending?.(pending),
        onSettled: (pendingId: string, persisted?: ConversationMessage) => {
          if (onMessageSettled) onMessageSettled(pendingId, persisted);
          else if (persisted) onMessagePersisted?.(persisted);
        },
        onFailed: (pendingId: string, reason: string, code?: string, persisted?: ConversationMessage) =>
          onMessageFailed?.(pendingId, reason, code, persisted),
      };
      // Primeiro os arquivos (na ordem escolhida), depois o texto da caixa: tudo na mesma fila da conversa.
      for (const file of outgoing.takeReady()) {
        void sendMediaQueued(
          conversationId,
          {
            path: file.path as string,
            name: file.name,
            mime: file.mime,
            size: file.size,
            kind: file.kind,
            caption: file.caption,
            asDocument: file.asDocument,
            previewUrl: file.previewUrl,
          },
          handlers,
        );
      }
      if (trimmed) void sendTextQueued(conversationId, trimmed, handlers);
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }

    if (isSubmitting) return;
    setIsSubmitting(true);
    setFeedback(null);

    try {
      // Envio de NOTA INTERNA (nunca vai pro WhatsApp)
      const result = await saveInternalNoteAction(conversationId, trimmed, opportunityId);
      if (result.success) {
        setText("");
        if (result.note) onInternalNoteSaved?.(result.note, opportunityId ?? null);
      } else {
        setFeedback({
          type: "error",
          message: result.error || "Falha ao salvar nota interna.",
        });
      }
    } catch {
      setFeedback({
        type: "error",
        message: "Erro de conexão ao processar a requisição.",
      });
    } finally {
      setIsSubmitting(false);
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashOpen) {
      if (e.key === "Escape") {
        e.preventDefault();
        dismissedSlashRef.current = slash?.start ?? null;
        setSlash(null);
        return;
      }
      if (quick.state !== "ready" && e.key === "Enter" && !e.shiftKey) {
        // Lista ainda carregando: Enter não envia a barra solta.
        e.preventDefault();
        return;
      }
      if (slashResults.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSlashIndex((index) => (index + 1) % slashResults.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSlashIndex((index) => (index - 1 + slashResults.length) % slashResults.length);
          return;
        }
        if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
          e.preventDefault();
          insertQuickReply(slashResults[Math.min(slashIndex, slashResults.length - 1)], "slash");
          return;
        }
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const isTextEmpty = text.trim() === "";
  const isOverLimit = text.length > MAX_CHAR_LIMIT;
  const showCounter = text.length >= COUNTER_SHOW_THRESHOLD;
  const hasReadyFiles = activeTab === "message" && outgoing.readyCount > 0;
  const isButtonDisabled = isSubmitting || (isTextEmpty && !hasReadyFiles) || isOverLimit || (activeTab === "message" && outgoing.uploading);

  return (
    <div className="shrink-0 border-t border-border bg-surface px-3 py-1.5 sm:px-4" data-testid="message-composer">
      {/* Abas: Mensagem vs Nota Interna */}
      <div className="mb-1 flex items-center gap-1 border-b border-border/60 pb-0.5 text-caption">
        <button
          aria-pressed={activeTab === "message"}
          className={[
            "flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-control px-2 font-medium transition-colors sm:px-3",
            activeTab === "message"
              ? "bg-primary/10 text-primary"
              : "text-text-muted hover:text-text",
          ].join(" ")}
          onClick={() => {
            setActiveTab("message");
            setFeedback(null);
          }}
          type="button"
        >
          <MessageSquare className="hidden sm:block" size={13} />
          <span>Mensagem</span>
        </button>

        <button
          aria-pressed={activeTab === "note"}
          className={[
            "flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-control px-2 font-medium transition-colors sm:px-3",
            activeTab === "note"
              ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
              : "text-text-muted hover:text-text",
          ].join(" ")}
          onClick={() => {
            setActiveTab("note");
            setFeedback(null);
          }}
          type="button"
        >
          <FileText className="hidden sm:block" size={13} />
          <span>Nota interna</span>
        </button>

        <div className="ml-auto flex items-center gap-1">
          <button
            aria-expanded={panelOpen}
            aria-haspopup="dialog"
            className="flex min-h-8 items-center gap-1 whitespace-nowrap rounded-control px-2 font-medium text-text-muted transition-colors hover:bg-neutral-soft hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            data-testid="quick-replies-button"
            onClick={() => {
              quick.ensureLoaded();
              setSlash(null);
              setPanelOpen(true);
            }}
            type="button"
          >
            <Zap aria-hidden="true" size={13} />
            <span>Respostas rápidas</span>
          </button>
          <button
            aria-label={expanded ? "Recolher a caixa de mensagem" : "Expandir a caixa de mensagem"}
            aria-pressed={expanded}
            className="flex size-8 items-center justify-center rounded-control text-text-muted transition-colors hover:bg-neutral-soft hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            data-testid="composer-expand"
            onClick={() => setExpanded((current) => !current)}
            type="button"
          >
            {expanded ? <Minimize2 aria-hidden="true" size={15} /> : <Maximize2 aria-hidden="true" size={15} />}
          </button>
        </div>
      </div>

      {/* Feedback Acessível */}
      <div aria-live="polite" className="sr-only" role="status">
        {feedback?.message ?? ""}
      </div>

      {feedback && (
        <div
          className={[
            "mb-2 flex min-h-11 items-center justify-between rounded-control px-3 py-1.5 text-caption font-medium",
            feedback.type === "success"
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : feedback.type === "error"
                ? "bg-danger-soft text-danger"
                : "bg-info-soft text-info",
          ].join(" ")}
          id="msg-send-feedback"
        >
          <span>{feedback.message}</span>
          <button
            aria-label="Fechar mensagem de status"
            className="ml-2 flex size-11 shrink-0 items-center justify-center rounded-control text-text-muted hover:bg-surface/70 hover:text-text"
            onClick={() => setFeedback(null)}
            type="button"
          >
            ✕
          </button>
        </div>
      )}

      {activeTab === "message" ? <OutgoingFilesTray files={outgoing} /> : null}

      <input
        accept={ACCEPT_ATTRIBUTE}
        aria-hidden="true"
        className="hidden"
        data-testid="file-input"
        multiple
        onChange={(event) => {
          const chosen = Array.from(event.target.files ?? []);
          event.target.value = "";
          void outgoing.addFiles(chosen);
        }}
        ref={fileInputRef}
        tabIndex={-1}
        type="file"
      />

      <form
        aria-label={
          activeTab === "note"
            ? "Formulário de nota interna"
            : "Formulário de envio de mensagem"
        }
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
      >
        <button
          aria-label="Anexar arquivo"
          className="flex size-11 shrink-0 items-center justify-center rounded-control border border-border text-text-muted transition-colors hover:bg-neutral-soft hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="attach-button"
          disabled={activeTab !== "message" || !filesEnabled}
          onClick={() => fileInputRef.current?.click()}
          title={!filesEnabled ? "Arquivos só em conversas individuais" : activeTab === "message" ? "Anexar arquivo (ou arraste para a conversa, ou cole com Ctrl+V)" : "Arquivos só em mensagens ao cliente"}
          type="button"
        >
          <Paperclip aria-hidden="true" size={18} />
        </button>

        <div className="relative flex-1">
          <label className="sr-only" htmlFor={inputId}>
            {activeTab === "note" ? "Nota interna" : "Mensagem de texto"}
          </label>
          {slashOpen ? (
            <SlashMenu
              activeIndex={slashIndex}
              id={slashMenuId}
              onHover={setSlashIndex}
              onPick={(reply) => insertQuickReply(reply, "slash")}
              query={slash?.query ?? ""}
              results={slashResults}
              state={quick.state}
            />
          ) : null}
          <textarea
            aria-activedescendant={slashOpen && slashResults.length > 0 ? slashOptionId(slashMenuId, Math.min(slashIndex, slashResults.length - 1)) : undefined}
            aria-autocomplete={slashOpen ? "list" : undefined}
            aria-controls={slashOpen && slashResults.length > 0 ? slashMenuId : undefined}
            aria-describedby={showCounter ? `${inputId}-counter` : undefined}
            aria-invalid={isOverLimit}
            aria-label={
              activeTab === "note"
                ? "Digitar nota interna (apenas CRM)"
                : "Digitar mensagem de texto"
            }
            className={[
              "min-h-11 w-full resize-none rounded-control border bg-background px-3 py-2 text-body text-text placeholder:text-text-muted focus:outline-none focus:ring-2 disabled:opacity-50",
              activeTab === "note"
                ? "border-amber-500/40 focus:border-amber-500 focus:ring-amber-500"
                : "border-border focus:border-primary focus:ring-primary",
            ].join(" ")}
            id={inputId}
            maxLength={MAX_CHAR_LIMIT}
            onBlur={(e) => {
              selectionRef.current = { start: e.target.selectionStart, end: e.target.selectionEnd };
            }}
            onChange={(e) => handleTextChange(e.target.value, e.target.selectionStart)}
            onKeyDown={handleKeyDown}
            onPaste={(event) => {
              // Colar imagem/arquivo (Ctrl+V): vira anexo, em vez de texto.
              if (activeTab !== "message" || !filesEnabled) return;
              const pasted = Array.from(event.clipboardData?.files ?? []);
              if (pasted.length === 0) return;
              event.preventDefault();
              void outgoing.addFiles(pasted);
            }}
            onSelect={(e) => {
              const element = e.currentTarget;
              selectionRef.current = { start: element.selectionStart, end: element.selectionEnd };
              if (element.selectionStart === element.selectionEnd) syncSlash(element.value, element.selectionStart);
            }}
            placeholder={
              activeTab === "note"
                ? "Escreva uma nota interna (visível APENAS no CRM, nunca enviada ao cliente)..."
                : "Digite sua mensagem (Enter envia, / respostas rápidas)..."
            }
            ref={textareaRef}
            rows={1}
            value={text}
          />
          {showCounter && (
            <span
              className={[
                "absolute bottom-2 right-3 text-caption",
                isOverLimit ? "font-bold text-danger" : "text-text-muted",
              ].join(" ")}
              id={`${inputId}-counter`}
            >
              {text.length} / {MAX_CHAR_LIMIT}
            </span>
          )}
        </div>

        <button
          aria-label={
            isSubmitting
              ? "Processando..."
              : activeTab === "note"
                ? "Salvar nota interna"
                : "Enviar mensagem"
          }
          className={[
            "flex size-11 shrink-0 items-center justify-center gap-2 rounded-control p-0 text-body font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:h-auto sm:w-auto sm:min-w-11 sm:px-4 sm:py-2.5",
            activeTab === "note"
              ? "bg-amber-600 text-white hover:bg-amber-700"
              : "bg-primary text-primary-foreground hover:bg-primary/90",
          ].join(" ")}
          disabled={isButtonDisabled}
          id="btn-send-message"
          type="submit"
        >
          {activeTab === "note" ? <FileText size={18} /> : <Send size={18} />}
          <span className="hidden sm:inline">
            {isSubmitting
              ? "Processando..."
              : activeTab === "note"
                ? "Salvar nota"
                : "Enviar"}
          </span>
        </button>
      </form>

      <QuickRepliesPanel
        error={quick.error}
        library={quick.library}
        onClose={() => setPanelOpen(false)}
        onInsert={(reply) => insertQuickReply(reply, "panel")}
        onReload={() => void quick.reload()}
        open={panelOpen}
        state={quick.state}
      />

      <ConfirmDialog
        confirmLabel="Enviar mesmo assim"
        description={unresolved ? unresolvedWarning(unresolved) : ""}
        onCancel={() => {
          setUnresolved(null);
          window.setTimeout(() => textareaRef.current?.focus(), 0);
        }}
        onConfirm={() => {
          setUnresolved(null);
          void handleSubmit({ skipConfirm: true });
        }}
        open={unresolved !== null}
        title="Campos não preenchidos"
      />
    </div>
  );
}
