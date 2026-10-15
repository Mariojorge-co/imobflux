import type { ConversationMessage } from "@/lib/conversations/data";
import { buildPendingMessage } from "@/lib/conversations/message-merge";

// Fila de envio por conversa: a caixa de mensagem fica livre na hora (a bolha aparece como "enviando…") e os envios
// de UMA conversa saem do navegador para o servidor um de cada vez, na ordem em que foram pedidos. A falha de um não
// impede os seguintes. Nada é reenviado sozinho: "tentar de novo" é uma nova mensagem, com nova chave de idempotência.

/** Executa tarefas assíncronas uma por vez, na ordem. Uma tarefa que lança erro não trava as seguintes. */
export class SequentialQueue {
  private tail: Promise<void> = Promise.resolve();
  private waiting = 0;

  /** Quantas tarefas estão na fila ou em andamento. */
  get size(): number {
    return this.waiting;
  }

  enqueue(task: () => Promise<void>): Promise<void> {
    this.waiting += 1;
    const run = this.tail.then(task, task).then(
      () => undefined,
      () => undefined,
    );
    this.tail = run.finally(() => {
      this.waiting -= 1;
    });
    return run;
  }
}

const queues = new Map<string, SequentialQueue>();

/** A fila da conversa (uma só por conversa, durante toda a sessão do navegador). */
export function queueFor(conversationId: string): SequentialQueue {
  let queue = queues.get(conversationId);
  if (!queue) {
    queue = new SequentialQueue();
    queues.set(conversationId, queue);
  }
  return queue;
}

/** Resultado de um envio, como devolvido pela server action de enviar texto. */
export type SendOutcome =
  | { success: true; message?: ConversationMessage }
  // Em arquivo, a falha pode devolver a mensagem já gravada como "falhou" (para o "tentar de novo" usar o id real).
  | { success: false; error: string; code?: string; message?: ConversationMessage };

export type SendHandlers = {
  /** A bolha provisória ("enviando…") assim que a pessoa envia. */
  onSending: (pending: ConversationMessage) => void;
  /** Enviada: sai a provisória e entra a mensagem gravada (se o servidor devolveu). */
  onSettled: (pendingId: string, persisted?: ConversationMessage) => void;
  /** Falhou: a bolha fica como "não enviada" com o motivo e a opção de tentar de novo. */
  onFailed: (pendingId: string, reason: string, code?: string, persisted?: ConversationMessage) => void;
};

export type SendFunction = (conversationId: string, text: string, idempotencyKey: string) => Promise<SendOutcome>;

export const CONNECTION_ERROR_MESSAGE = "Erro de conexão ao enviar. Verifique a internet e tente de novo.";

/** Coloca QUALQUER envio (texto ou arquivo) na fila da conversa, com a bolha provisória já criada. */
export function enqueueSend(input: {
  conversationId: string;
  pending: ConversationMessage;
  handlers: SendHandlers;
  run: () => Promise<SendOutcome>;
}): { pending: ConversationMessage; done: Promise<void> } {
  input.handlers.onSending(input.pending);
  const done = queueFor(input.conversationId).enqueue(async () => {
    try {
      const result = await input.run();
      if (result.success) input.handlers.onSettled(input.pending.id, result.message);
      else input.handlers.onFailed(input.pending.id, result.error, result.code, result.message);
    } catch {
      input.handlers.onFailed(input.pending.id, CONNECTION_ERROR_MESSAGE, "NETWORK");
    }
  });
  return { pending: input.pending, done };
}

/**
 * Coloca um texto na fila da conversa. Devolve na hora a bolha provisória (já anunciada em `onSending`) e uma promessa
 * que termina quando este envio (sucesso ou falha) acaba. Cada envio tem a sua própria chave de idempotência.
 */
export function enqueueTextSend(input: {
  conversationId: string;
  text: string;
  handlers: SendHandlers;
  send: SendFunction;
  /** Para testes: chave e hora fixas. */
  idempotencyKey?: string;
  now?: Date;
}): { pending: ConversationMessage; done: Promise<void> } {
  const idempotencyKey = input.idempotencyKey ?? crypto.randomUUID();
  const pending = buildPendingMessage({ idempotencyKey, text: input.text, now: input.now });
  return enqueueSend({
    conversationId: input.conversationId,
    pending,
    handlers: input.handlers,
    run: () => input.send(input.conversationId, input.text, idempotencyKey),
  });
}
