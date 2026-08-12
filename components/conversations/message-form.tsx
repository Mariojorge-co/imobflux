"use client";

import {
  useCallback,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { FileText, MessageSquare, Send } from "lucide-react";
import {
  saveInternalNoteAction,
  sendMessageAction,
} from "@/lib/conversations/actions";
import type {
  ConversationContextData,
  ConversationMessage,
} from "@/lib/conversations/data";

const MAX_CHAR_LIMIT = 4096;
const COUNTER_SHOW_THRESHOLD = 3500;

type MessageFormProps = {
  conversationId: string;
  opportunityId?: string | null;
  onInternalNoteSaved?: (
    note: ConversationContextData["notes"][number],
    opportunityId: string | null,
  ) => void;
  onMessagePersisted?: (message: ConversationMessage) => void;
};

export function MessageForm({
  conversationId,
  opportunityId,
  onInternalNoteSaved,
  onMessagePersisted,
}: MessageFormProps) {
  const [activeTab, setActiveTab] = useState<"message" | "note">("message");
  const [text, setText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);

  const activeIdempotencyKeyRef = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const reactId = useId();
  const inputId = typeof reactId === "string" ? reactId : "input-message-text";

  const getOrCreateIdempotencyKey = useCallback(() => {
    if (!activeIdempotencyKeyRef.current) {
      activeIdempotencyKeyRef.current = crypto.randomUUID();
    }
    return activeIdempotencyKeyRef.current;
  }, []);

  const handleTextChange = (newText: string) => {
    if (newText !== text) {
      activeIdempotencyKeyRef.current = null;
    }
    setText(newText);
    if (feedback) {
      setFeedback(null);
    }
  };

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (!trimmed || isSubmitting) return;

    if (trimmed.length > MAX_CHAR_LIMIT) {
      setFeedback({
        type: "error",
        message: `O texto excede o limite máximo de ${MAX_CHAR_LIMIT} caracteres.`,
      });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);

    try {
      if (activeTab === "note") {
        // Envio de NOTA INTERNA (nunca vai pro WhatsApp)
        const result = await saveInternalNoteAction(
          conversationId,
          trimmed,
          opportunityId,
        );
        if (result.success) {
          setText("");
          if (result.note) onInternalNoteSaved?.(result.note, opportunityId ?? null);
        } else {
          setFeedback({
            type: "error",
            message: result.error || "Falha ao salvar nota interna.",
          });
        }
      } else {
        // Envio de MENSAGEM normal ao cliente
        const idempotencyKey = getOrCreateIdempotencyKey();
        const result = await sendMessageAction(
          conversationId,
          trimmed,
          idempotencyKey,
        );

        if (result.success) {
          setText("");
          activeIdempotencyKeyRef.current = null;
          if (result.message) onMessagePersisted?.(result.message);

          if (result.status === "duplicate") {
            setFeedback({
              type: "info",
              message: "Mensagem já registrada.",
            });
          }
        } else {
          if (result.code === "UNAUTHORIZED") {
            setFeedback({
              type: "error",
              message: "Sessão expirada. Por favor, faça login novamente.",
            });
          } else if (result.code === "PREVIOUSLY_FAILED") {
            setFeedback({
              type: "error",
              message:
                "Esta mensagem falhou em uma tentativa anterior. Altere o texto ou envie novamente.",
            });
          } else {
            setFeedback({
              type: "error",
              message:
                result.error ||
                "Falha ao enviar mensagem. Tente novamente mais tarde.",
            });
          }
        }
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
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const isTextEmpty = text.trim() === "";
  const isOverLimit = text.length > MAX_CHAR_LIMIT;
  const showCounter = text.length >= COUNTER_SHOW_THRESHOLD;
  const isButtonDisabled = isSubmitting || isTextEmpty || isOverLimit;

  return (
    <div className="shrink-0 border-t border-border bg-surface px-4 py-2.5">
      {/* Abas: Mensagem vs Nota Interna */}
      <div className="mb-2 flex items-center gap-1 border-b border-border/60 pb-1.5 text-xs">
        <button
          aria-pressed={activeTab === "message"}
          className={[
            "flex items-center gap-1.5 rounded-control px-2.5 py-1 font-medium transition-colors",
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
          <MessageSquare size={13} />
          <span>Mensagem</span>
        </button>

        <button
          aria-pressed={activeTab === "note"}
          className={[
            "flex items-center gap-1.5 rounded-control px-2.5 py-1 font-medium transition-colors",
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
          <FileText size={13} />
          <span>Nota interna</span>
        </button>
      </div>

      {/* Feedback Acessível */}
      <div aria-live="polite" className="sr-only" role="status">
        {feedback?.message ?? ""}
      </div>

      {feedback && (
        <div
          className={[
            "mb-2 flex items-center justify-between rounded-md px-3 py-1.5 text-xs font-medium",
            feedback.type === "success"
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : feedback.type === "error"
                ? "bg-destructive/10 text-destructive"
                : "bg-blue-500/10 text-blue-600 dark:text-blue-400",
          ].join(" ")}
          id="msg-send-feedback"
        >
          <span>{feedback.message}</span>
          <button
            aria-label="Fechar mensagem de status"
            className="ml-2 text-text-muted hover:text-text"
            onClick={() => setFeedback(null)}
            type="button"
          >
            ✕
          </button>
        </div>
      )}

      <form
        aria-label={
          activeTab === "note"
            ? "Formulário de nota interna"
            : "Formulário de envio de mensagem"
        }
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
      >
        <div className="relative flex-1">
          <label className="sr-only" htmlFor={inputId}>
            {activeTab === "note" ? "Nota interna" : "Mensagem de texto"}
          </label>
          <textarea
            aria-describedby={showCounter ? `${inputId}-counter` : undefined}
            aria-invalid={isOverLimit}
            aria-label={
              activeTab === "note"
                ? "Digitar nota interna (apenas CRM)"
                : "Digitar mensagem de texto"
            }
            className={[
              "w-full resize-none rounded-control border bg-background px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-1 disabled:opacity-50",
              activeTab === "note"
                ? "border-amber-500/40 focus:border-amber-500 focus:ring-amber-500"
                : "border-border focus:border-primary focus:ring-primary",
            ].join(" ")}
            disabled={isSubmitting}
            id={inputId}
            maxLength={MAX_CHAR_LIMIT}
            onChange={(e) => handleTextChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              activeTab === "note"
                ? "Escreva uma nota interna (visível APENAS no CRM, nunca enviada ao cliente)..."
                : "Digite sua mensagem (Enter para enviar, Shift+Enter para nova linha)..."
            }
            ref={textareaRef}
            rows={2}
            value={text}
          />
          {showCounter && (
            <span
              className={[
                "absolute bottom-2 right-3 text-[10px]",
                isOverLimit ? "font-bold text-destructive" : "text-text-muted",
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
            "flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center gap-2 rounded-control px-3 sm:px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
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
    </div>
  );
}
