import { expect, test } from "@playwright/test";
import { jidSuffixClass, reactionIgnoredDiagnostics } from "../lib/conversations/webhook-shape";

test.describe("log seguro de reação ignorada", () => {
  test("classifica o sufixo do JID sem expor o número", () => {
    expect(jidSuffixClass("5582988880000@s.whatsapp.net")).toBe("s.whatsapp.net");
    expect(jidSuffixClass("218943875198110@lid")).toBe("lid");
    expect(jidSuffixClass("120363000000000001@g.us")).toBe("g.us");
    expect(jidSuffixClass("5582988880000@c.us")).toBe("outro");
    expect(jidSuffixClass("5582988880000")).toBe("ausente");
    expect(jidSuffixClass(undefined)).toBe("ausente");
    expect(jidSuffixClass(null)).toBe("ausente");
  });

  test("a linha traz classe, quantidade de dígitos e presença do telefone alternativo", () => {
    const line = reactionIgnoredDiagnostics(
      { remoteJid: "218943875198110@lid", remoteJidAlt: "558288880000@s.whatsapp.net", fromMe: false },
      "558288880000@s.whatsapp.net",
    );
    expect(line).toBe("sufixo_conversa=lid sufixo_reator=s.whatsapp.net digitos_reator=12 alt_presente=sim");
  });

  test("sem telefone alternativo e com @lid no reator", () => {
    const line = reactionIgnoredDiagnostics({ remoteJid: "218943875198110@lid" }, "218943875198110@lid");
    expect(line).toBe("sufixo_conversa=lid sufixo_reator=lid digitos_reator=15 alt_presente=nao");
  });

  test("nunca devolve o número, o nome nem o emoji", () => {
    const line = reactionIgnoredDiagnostics(
      { remoteJid: "5582988887777@s.whatsapp.net", remoteJidAlt: "", pushName: "Fulano de Tal", text: "👍" },
      "5582988887777@s.whatsapp.net",
    );
    expect(line).not.toMatch(/5582988887777/);
    expect(line).not.toMatch(/Fulano/);
    expect(line).not.toMatch(/👍/);
    expect(line).toContain("alt_presente=nao");
  });

  test("entradas inválidas não quebram", () => {
    expect(reactionIgnoredDiagnostics(null, undefined)).toBe("sufixo_conversa=ausente sufixo_reator=ausente digitos_reator=0 alt_presente=nao");
    expect(reactionIgnoredDiagnostics("x", 5)).toBe("sufixo_conversa=ausente sufixo_reator=ausente digitos_reator=0 alt_presente=nao");
  });
});
