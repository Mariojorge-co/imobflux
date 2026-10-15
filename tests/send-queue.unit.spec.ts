import "./helpers/server-only";

import { expect, test } from "@playwright/test";
import type { ConversationMessage } from "../lib/conversations/data";
import { failPendingMessage, isDismissedFailure, mergeMessages, outgoingStatusLabel } from "../lib/conversations/message-merge";
import {
  CONNECTION_ERROR_MESSAGE,
  enqueueTextSend,
  SequentialQueue,
  type SendHandlers,
  type SendOutcome,
} from "../lib/conversations/send-queue";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function recorder() {
  const events: string[] = [];
  const handlers: SendHandlers = {
    onSending: (pending) => events.push(`sending:${pending.text_content}`),
    onSettled: (_id, persisted) => events.push(`settled:${persisted?.text_content ?? "-"}`),
    onFailed: (_id, reason, code) => events.push(`failed:${code ?? "-"}:${reason}`),
  };
  return { events, handlers };
}

function persisted(text: string, id = `real-${text}`): ConversationMessage {
  return {
    id,
    direction: "outgoing",
    origin: "crm",
    status: "sent",
    text_content: text,
    occurred_at: "2026-10-15T12:00:00.000Z",
    has_attachments: false,
  };
}

test.describe("fila de envio por conversa", () => {
  test("tarefas rodam uma por vez, na ordem pedida, mesmo com tempos diferentes", async () => {
    const queue = new SequentialQueue();
    const log: string[] = [];
    let running = 0;
    let maxRunning = 0;
    const task = (name: string, ms: number) => async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      log.push(`start:${name}`);
      await delay(ms);
      log.push(`end:${name}`);
      running -= 1;
    };
    await Promise.all([queue.enqueue(task("a", 30)), queue.enqueue(task("b", 5)), queue.enqueue(task("c", 15))]);
    expect(log).toEqual(["start:a", "end:a", "start:b", "end:b", "start:c", "end:c"]);
    expect(maxRunning).toBe(1);
    expect(queue.size).toBe(0);
  });

  test("a falha de uma tarefa não impede as seguintes", async () => {
    const queue = new SequentialQueue();
    const ran: string[] = [];
    await Promise.all([
      queue.enqueue(async () => {
        ran.push("1");
      }),
      queue.enqueue(async () => {
        throw new Error("boom");
      }),
      queue.enqueue(async () => {
        ran.push("3");
      }),
    ]);
    expect(ran).toEqual(["1", "3"]);
  });

  test("3 mensagens seguidas: bolhas na hora, envio sequencial na ordem, chaves diferentes, sem duplicar", async () => {
    const { events, handlers } = recorder();
    const sentOrder: string[] = [];
    const keys: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const send = async (_conversation: string, text: string, key: string): Promise<SendOutcome> => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      keys.push(key);
      await delay(text === "um" ? 40 : 5);
      sentOrder.push(text);
      inFlight -= 1;
      return { success: true, message: persisted(text) };
    };

    const first = enqueueTextSend({ conversationId: "conv-ordem", text: "um", handlers, send });
    const second = enqueueTextSend({ conversationId: "conv-ordem", text: "dois", handlers, send });
    const third = enqueueTextSend({ conversationId: "conv-ordem", text: "tres", handlers, send });

    // As três bolhas aparecem imediatamente, antes de qualquer envio terminar.
    expect(events).toEqual(["sending:um", "sending:dois", "sending:tres"]);
    expect(sentOrder).toEqual([]);

    await Promise.all([first.done, second.done, third.done]);
    expect(sentOrder).toEqual(["um", "dois", "tres"]);
    expect(maxInFlight).toBe(1);
    expect(new Set(keys).size).toBe(3);
    expect(events.slice(3)).toEqual(["settled:um", "settled:dois", "settled:tres"]);
    expect(new Set([first.pending.id, second.pending.id, third.pending.id]).size).toBe(3);
  });

  test("falha simulada no meio: só aquela fica 'não enviada' com o motivo; as demais seguem", async () => {
    const { events, handlers } = recorder();
    const sentOrder: string[] = [];
    const send = async (_c: string, text: string): Promise<SendOutcome> => {
      sentOrder.push(text);
      if (text === "dois") return { success: false, error: "O WhatsApp recusou a mensagem.", code: "EVOLUTION_REJECTED" };
      return { success: true, message: persisted(text) };
    };
    const jobs = ["um", "dois", "tres"].map((text) => enqueueTextSend({ conversationId: "conv-falha", text, handlers, send }));
    await Promise.all(jobs.map((job) => job.done));
    expect(sentOrder).toEqual(["um", "dois", "tres"]);
    expect(events).toContain("failed:EVOLUTION_REJECTED:O WhatsApp recusou a mensagem.");
    expect(events.filter((event) => event.startsWith("settled:"))).toEqual(["settled:um", "settled:tres"]);
  });

  test("erro de rede (a chamada lança) vira falha com mensagem clara e não trava a fila", async () => {
    const { events, handlers } = recorder();
    let calls = 0;
    const send = async (_c: string, text: string): Promise<SendOutcome> => {
      calls += 1;
      if (calls === 1) throw new Error("fetch failed");
      return { success: true, message: persisted(text) };
    };
    const a = enqueueTextSend({ conversationId: "conv-rede", text: "a", handlers, send });
    const b = enqueueTextSend({ conversationId: "conv-rede", text: "b", handlers, send });
    await Promise.all([a.done, b.done]);
    expect(events).toContain(`failed:NETWORK:${CONNECTION_ERROR_MESSAGE}`);
    expect(events).toContain("settled:b");
  });

  test("conversas diferentes têm filas independentes", async () => {
    const { handlers } = recorder();
    const order: string[] = [];
    const slow = async (): Promise<SendOutcome> => {
      await delay(40);
      order.push("lenta");
      return { success: true };
    };
    const fast = async (): Promise<SendOutcome> => {
      order.push("rapida");
      return { success: true };
    };
    const a = enqueueTextSend({ conversationId: "conv-A", text: "x", handlers, send: slow });
    const b = enqueueTextSend({ conversationId: "conv-B", text: "y", handlers, send: fast });
    await Promise.all([a.done, b.done]);
    expect(order).toEqual(["rapida", "lenta"]);
  });

  test("tentar de novo é uma nova mensagem: nova chave, nada é reenviado sozinho", async () => {
    const { handlers } = recorder();
    const keys: string[] = [];
    let attempts = 0;
    const send = async (_c: string, _t: string, key: string): Promise<SendOutcome> => {
      keys.push(key);
      attempts += 1;
      return attempts === 1 ? { success: false, error: "falhou", code: "X" } : { success: true };
    };
    const first = enqueueTextSend({ conversationId: "conv-retry", text: "oi", handlers, send });
    await first.done;
    expect(attempts).toBe(1); // a falha não dispara nova tentativa
    const retry = enqueueTextSend({ conversationId: "conv-retry", text: "oi", handlers, send });
    await retry.done;
    expect(attempts).toBe(2);
    expect(keys[0]).not.toBe(keys[1]);
  });
});

test.describe("bolhas: falha, eco e duplicação", () => {
  const base = (partial: Partial<ConversationMessage> & { id: string }): ConversationMessage => ({
    direction: "outgoing",
    origin: "crm",
    status: "sending",
    text_content: "oi",
    occurred_at: "2026-10-15T12:00:00.000Z",
    has_attachments: false,
    ...partial,
  });

  test("a provisória que falhou fica na tela como 'não enviada' com o motivo", () => {
    const failed = failPendingMessage([base({ id: "pending-1" })], "pending-1", "WhatsApp fora do ar");
    expect(failed[0].status).toBe("failed");
    expect(failed[0].send_error).toBe("WhatsApp fora do ar");
    expect(outgoingStatusLabel(failed[0])).toBe("failed");
  });

  test("uma provisória que falhou não some quando chega outra mensagem igual na fila", () => {
    const failed = base({ id: "pending-1", status: "failed", send_error: "x" });
    const retryQueued = base({ id: "real-2", status: "queued" });
    const merged = mergeMessages([failed], [retryQueued]);
    expect(merged.map((message) => message.id).sort()).toEqual(["pending-1", "real-2"]);
  });

  test("a provisória que falhou é substituída pela falha gravada (sem bolha dupla) e o motivo passa para ela", () => {
    const pendingFailed = base({ id: "pending-1", status: "failed", send_error: "WhatsApp fora do ar" });
    const storedFailed = base({ id: "real-1", status: "failed", occurred_at: "2026-10-15T12:00:00.400Z" });
    const merged = mergeMessages([pendingFailed], [storedFailed]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("real-1");
    expect(merged[0].send_error).toBe("WhatsApp fora do ar");
  });

  test("falha já refeita fica escondida, mesmo que a versão gravada chegue depois", () => {
    const dismissed = [{ id: "pending-1", text: "oi", at: "2026-10-15T12:00:00.000Z" }];
    expect(isDismissedFailure(base({ id: "pending-1", status: "failed" }), dismissed)).toBe(true);
    expect(isDismissedFailure(base({ id: "real-9", status: "failed", occurred_at: "2026-10-15T12:00:00.800Z" }), dismissed)).toBe(true);
    // a nova tentativa (enviando/enviada) e mensagens de outro texto nunca ficam escondidas
    expect(isDismissedFailure(base({ id: "real-10", status: "queued", occurred_at: "2026-10-15T12:00:05.000Z" }), dismissed)).toBe(false);
    expect(isDismissedFailure(base({ id: "real-11", status: "failed", text_content: "outro" }), dismissed)).toBe(false);
    expect(isDismissedFailure(base({ id: "real-12", status: "failed" }), [])).toBe(false);
  });

  test("a 'enviando…' é substituída uma a uma pela versão gravada (sem bolha duplicada)", () => {
    const p1 = base({ id: "pending-1", occurred_at: "2026-10-15T12:00:00.000Z" });
    const p2 = base({ id: "pending-2", occurred_at: "2026-10-15T12:00:01.000Z" });
    const r1 = base({ id: "real-1", status: "queued", occurred_at: "2026-10-15T12:00:00.500Z" });
    const merged = mergeMessages([p1, p2], [r1]);
    expect(merged.map((message) => message.id)).toEqual(["real-1", "pending-2"]);
  });

  test("o eco de um ARQUIVO (mesmo rótulo, com anexo) também não vira bolha duplicada; eco sem anexo de texto igual continua separado", () => {
    const own = base({ id: "real-1", status: "sent", text_content: "📄 Documento: a.pdf", has_attachments: true });
    const echo = base({ id: "echo-1", origin: "whatsapp", status: "sent", text_content: "📄 Documento: a.pdf", has_attachments: true, occurred_at: "2026-10-15T12:00:02.000Z" });
    expect(mergeMessages([own], [echo]).map((message) => message.id)).toEqual(["real-1"]);
    const textOnlyEcho = { ...echo, id: "echo-2", has_attachments: false };
    expect(mergeMessages([own], [textOnlyEcho]).map((message) => message.id).sort()).toEqual(["echo-2", "real-1"]);
  });

  test("o eco do webhook (origem whatsapp, mesmo texto e instante) não vira bolha duplicada", () => {
    const own = base({ id: "real-1", status: "sent" });
    const echo = base({ id: "echo-1", origin: "whatsapp", status: "sent", occurred_at: "2026-10-15T12:00:02.000Z" });
    expect(mergeMessages([own], [echo]).map((message) => message.id)).toEqual(["real-1"]);
  });
});
