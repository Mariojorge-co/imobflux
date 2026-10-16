import { expect, test } from "@playwright/test";
import { ESCAPE_PRIORITY, handleEscape, registerEscapeLayer } from "../lib/ui/escape-stack";
import { clearDraft, getDraft, setDraft } from "../lib/conversations/drafts";

const escape = () => ({ key: "Escape" }) as KeyboardEvent;

test.describe("Esc em camadas", () => {
  test("fecha uma camada por vez, da mais alta para a mais baixa", () => {
    const closed: string[] = [];
    const off = [
      registerEscapeLayer(ESCAPE_PRIORITY.closeConversation, () => void closed.push("conversa")),
      registerEscapeLayer(ESCAPE_PRIORITY.conversationSearch, () => void closed.push("busca")),
      registerEscapeLayer(ESCAPE_PRIORITY.messageMenu, () => void closed.push("menu")),
      registerEscapeLayer(ESCAPE_PRIORITY.replyCard, () => void closed.push("citação")),
    ];
    // Cada Esc fecha só a de cima; aqui o teste "fecha" removendo a camada tratada, como a tela faz ao desmontar.
    const order: string[] = [];
    for (let step = 0; step < 4; step += 1) {
      closed.length = 0;
      expect(handleEscape(escape())).toBe(true);
      expect(closed).toHaveLength(1);
      order.push(closed[0]);
      const index = ["menu", "busca", "citação", "conversa"].indexOf(closed[0]);
      // remove a camada correspondente (a prioridade mais alta restante passa a valer no próximo Esc)
      off[[2, 1, 3, 0][index]]();
    }
    expect(order).toEqual(["menu", "busca", "citação", "conversa"]);
    expect(handleEscape(escape())).toBe(false);
  });

  test("a ordem pedida: menu > emoji > painel > pré-visualização > busca > citação > gravação > edição > lista '/' > conversa", () => {
    const p = ESCAPE_PRIORITY;
    const sequence = [p.messageMenu, p.emojiPicker, p.drawer, p.filePreview, p.conversationSearch, p.replyCard, p.voiceRecording, p.messageEdit, p.slashList, p.closeConversation];
    expect([...sequence].sort((a, b) => b - a)).toEqual(sequence);
    expect(new Set(sequence).size).toBe(sequence.length);
  });

  test("camada que devolve false deixa a próxima tentar; sem camadas, ninguém trata", () => {
    const calls: string[] = [];
    const off = [
      registerEscapeLayer(100, () => {
        calls.push("alta");
        return false;
      }),
      registerEscapeLayer(10, () => void calls.push("baixa")),
    ];
    expect(handleEscape(escape())).toBe(true);
    expect(calls).toEqual(["alta", "baixa"]);
    off.forEach((fn) => fn());
    expect(handleEscape(escape())).toBe(false);
  });

  test("mesma prioridade: a registrada por último (a mais nova) fecha primeiro", () => {
    const calls: string[] = [];
    const off = [registerEscapeLayer(50, () => void calls.push("antiga")), registerEscapeLayer(50, () => void calls.push("nova"))];
    handleEscape(escape());
    expect(calls).toEqual(["nova"]);
    off.forEach((fn) => fn());
  });
});

test.describe("Rascunho por conversa", () => {
  test("guarda por conversa, devolve ao reabrir e limpa ao enviar (texto vazio)", () => {
    clearDraft("a");
    clearDraft("b");
    expect(getDraft("a")).toBe("");
    setDraft("a", "oi, tudo bem?");
    setDraft("b", "outra coisa");
    expect(getDraft("a")).toBe("oi, tudo bem?");
    expect(getDraft("b")).toBe("outra coisa");
    setDraft("a", "");
    expect(getDraft("a")).toBe("");
    expect(getDraft("b")).toBe("outra coisa");
    clearDraft("b");
    expect(getDraft("b")).toBe("");
  });
});
