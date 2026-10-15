import { expect, test } from "@playwright/test";
import { describeSlaFor, SLA_TONE_CLASS } from "../lib/conversations/sla-display";

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

test.describe("SLA visual (cor, ícone e texto)", () => {
  test("cliente esperando: verde -> amarelo -> laranja -> vermelho conforme o tempo", () => {
    expect(describeSlaFor("incoming", ago(3))?.tone).toBe("green");
    expect(describeSlaFor("incoming", ago(12))?.tone).toBe("yellow");
    expect(describeSlaFor("incoming", ago(20))?.tone).toBe("orange");
    expect(describeSlaFor("incoming", ago(90))?.tone).toBe("red");
    expect(describeSlaFor("incoming", ago(60 * 30))?.tone).toBe("red");
  });

  test("só o vermelho é marcado como urgente", () => {
    expect(describeSlaFor("incoming", ago(3))?.urgent).toBe(false);
    expect(describeSlaFor("incoming", ago(20))?.urgent).toBe(false);
    expect(describeSlaFor("incoming", ago(45))?.urgent).toBe(true);
  });

  test("equipe respondeu: neutro enquanto recente; amarelo (6 h), laranja (24 h) e vermelho (72 h) quando o cliente demora", () => {
    expect(describeSlaFor("outgoing", ago(30))?.tone).toBe("neutral");
    expect(describeSlaFor("outgoing", ago(60 * 5))?.tone).toBe("neutral");
    expect(describeSlaFor("outgoing", ago(60 * 7))?.tone).toBe("yellow");
    expect(describeSlaFor("outgoing", ago(60 * 30))?.tone).toBe("orange");
    expect(describeSlaFor("outgoing", ago(60 * 24 * 4))?.tone).toBe("red");
    expect(describeSlaFor("outgoing", ago(60 * 24 * 4))?.teamWaiting).toBe(false);
    // Follow-up atrasado é vermelho, mas só a EQUIPE devendo resposta é "urgente".
    expect(describeSlaFor("outgoing", ago(60 * 24 * 4))?.urgent).toBe(false);
  });

  test("rótulo curto usa min, h e d; o texto completo vai para leitores de tela", () => {
    expect(describeSlaFor("incoming", ago(7))?.shortLabel).toBe("7 min");
    expect(describeSlaFor("incoming", ago(60 * 5))?.shortLabel).toBe("5 h");
    expect(describeSlaFor("incoming", ago(60 * 24 * 3))?.shortLabel).toBe("3 d");
    expect(describeSlaFor("incoming", ago(7))?.fullLabel).toContain("Cliente aguardando");
    expect(describeSlaFor("outgoing", ago(60 * 5))?.fullLabel).toContain("Aguardando cliente");
  });

  test("sem mensagem, direção desconhecida ou data inválida não mostram nada", () => {
    expect(describeSlaFor(null, ago(5))).toBeNull();
    expect(describeSlaFor("incoming", null)).toBeNull();
    expect(describeSlaFor("incoming", "não é data")).toBeNull();
    expect(describeSlaFor(undefined, undefined)).toBeNull();
  });

  test("toda cor tem classe definida", () => {
    for (const tone of ["green", "yellow", "orange", "red", "neutral"] as const) {
      expect(SLA_TONE_CLASS[tone]).toBeTruthy();
    }
  });
});
