"use client";

import {
  useCallback,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { sendMessageAction } from "@/lib/conversations/actions";

const MAX_CHAR_LIMIT = 4096;
const COUNTER_SHOW_THRESHOLD = 3500;

type MessageFormProps = {
  conversationId: string;
};

export function MessageForm({ conversationId }: MessageFormProps) {
  const [text, setText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);

  // Armazena a chave de idempotência do envio atual.
  // Uma nova chave só é gerada quando o usuário altera o texto ou após envio bem-sucedido.
  const activeIdempotencyKeyRef = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const reactId = useId();
  const inputId = typeof reactId === "string" ? reactId : "input-message-text";

  // Garante que existe uma chave de idempotência para a tentativa atual
  const getOrCreateIdempotencyKey = useCallback(() => {
    if (!activeIdempotencyKeyRef.current) {
      activeIdempotencyKeyRef.current = crypto.randomUUID();
    }
    return activeIdempotencyKeyRef.current;
  }, []);

  const handleTextChange = (newText: string) => {
    // Se o usuário alterou o texto, invalida a chave de idempotência anterior para criar uma nova
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
    if (!trimmed || isSubmitting) {
      return;
    }

    if (trimmed.length > MAX_CHAR_LIMIT) {
      setFeedback({
        type: "error",
        message: `O texto excede o limite máximo de ${MAX_CHAR_LIMIT} caracteres.`,
      });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);

    const idempotencyKey = getOrCreateIdempotencyKey();

    try {
      const result = await sendMessageAction(
        conversationId,
        trimmed,
        idempotencyKey,
      );

      if (result.success) {
        setText("");
        activeIdempotencyKeyRef.current = null; // Reseta a chave para a próxima mensagem

        if (result.status === "duplicate") {
          setFeedback({
            type: "info",
            message: "Mensagem já registrada.",
          });
        } else {
          setFeedback({
            type: "success",
            message: "Mensagem enviada com sucesso.",
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
    } catch {
      setFeedback({
        type: "error",
        message: "Erro de conexão ao processar o envio. Tente novamente.",
      });
    } finally {
      setIsSubmitting(false);
      // Retorna o foco ao textarea
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
    <div className="shrink-0 border-t border-border bg-surface px-4 py-3">
      {/* Feedback Acessível (aria-live) */}
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
        aria-label="Formulário de envio de mensagem"
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
      >
        <div className="relative flex-1">
          <label className="sr-only" htmlFor={inputId}>
            Mensagem de texto
          </label>
          <textarea
            aria-describedby={showCounter ? `${inputId}-counter` : undefined}
            aria-invalid={isOverLimit}
            aria-label="Digitar mensagem de texto"
            className="w-full resize-none rounded-control border border-border bg-background px-3 py-2 text-sm text-text placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
            disabled={isSubmitting}
            id={inputId}
            maxLength={MAX_CHAR_LIMIT}
            onChange={(e) => handleTextChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Digite sua mensagem (Enter para enviar, Shift+Enter para nova linha)..."
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
          aria-label={isSubmitting ? "Enviando mensagem..." : "Enviar mensagem"}
          className="flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-control bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isButtonDisabled}
          id="btn-send-message"
          type="submit"
        >
          <svg
            aria-hidden="true"
            className="shrink-0"
            dangerouslySetInnerHTML={{
              __html:
                '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
            }}
            fill="none"
            height={16}
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            viewBox="0 0 24 24"
            width={16}
          />
          <span>{isSubmitting ? "Enviando..." : "Enviar"}</span>
        </button>
      </form>
    </div>
  );
}
