import "./helpers/server-only";

import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { composerHeight, composerMaxHeight } from "../lib/quick-replies/composer-size";
import { filterReplies, groupByCategory, normalizeSearch, searchForSlash } from "../lib/quick-replies/filter";
import { detectSlashTrigger, insertAtCursor, replaceSlashTrigger } from "../lib/quick-replies/insert";
import { canManageItem, quickReplyErrorMessage } from "../lib/quick-replies/permissions";
import type { QuickReply, QuickReplyCategory } from "../lib/quick-replies/types";
import {
  findUnresolvedVariables,
  resolveVariables,
  splitVariableSegments,
  unresolvedWarning,
  usableContactName,
} from "../lib/quick-replies/variables";
import { IMAGE_MAX_SIDE_DESKTOP_PX, IMAGE_MAX_SIDE_MOBILE_PX } from "../lib/conversations/sticker";

const context = { contactName: "Maria das Dores Souza", memberName: "Carlos Lima", workspaceName: "Imobiliária Farol" };

function reply(partial: Partial<QuickReply> & { id: string; title: string }): QuickReply {
  return {
    body: "texto",
    category_id: null,
    is_active: true,
    use_count: 0,
    last_used_at: null,
    created_by_member_id: "m1",
    ...partial,
  };
}

test.describe("variáveis das respostas rápidas", () => {
  test("resolve as quatro variáveis conhecidas", () => {
    expect(resolveVariables("Oi, {{nome}}! Sou {{meu_nome}} da {{empresa}}. Contrato de {{nome_completo}}.", context)).toBe(
      "Oi, Maria! Sou Carlos Lima da Imobiliária Farol. Contrato de Maria das Dores Souza.",
    );
  });

  test("aceita espaços e maiúsculas dentro das chaves", () => {
    expect(resolveVariables("{{ nome }} e {{NOME}}", context)).toBe("Maria e Maria");
  });

  test("variável desconhecida permanece literal, e é listada como não resolvida", () => {
    const resolved = resolveVariables("Visita ao {{imovel}} com {{nome}} às {{hora}} e {{imovel}}", context);
    expect(resolved).toBe("Visita ao {{imovel}} com Maria às {{hora}} e {{imovel}}");
    expect(findUnresolvedVariables(resolved)).toEqual(["{{imovel}}", "{{hora}}"]);
  });

  test("sem nome utilizável (vazio ou só telefone) {{nome}} permanece literal", () => {
    expect(resolveVariables("Oi {{nome}}", { ...context, contactName: "" })).toBe("Oi {{nome}}");
    expect(resolveVariables("Oi {{nome}}", { ...context, contactName: "+55 82 99999-0001" })).toBe("Oi {{nome}}");
    expect(resolveVariables("Oi {{nome_completo}}", { ...context, contactName: null })).toBe("Oi {{nome_completo}}");
    expect(usableContactName("  Ana   Paula ")).toBe("Ana Paula");
  });

  test("preserva exatamente quebras de linha, listas, emojis e marcação do WhatsApp", () => {
    const body = "Olá, {{nome}}! 😊\n\n*Documentos:*\n• RG\n• _CPF_\n\n  Atenciosamente,\n~{{meu_nome}}~\n";
    expect(resolveVariables(body, context)).toBe("Olá, Maria! 😊\n\n*Documentos:*\n• RG\n• _CPF_\n\n  Atenciosamente,\n~Carlos Lima~\n");
  });

  test("valor com símbolos especiais é inserido literalmente", () => {
    expect(resolveVariables("{{nome}}", { contactName: "Ana $& $1 Silva" })).toBe("Ana");
    expect(resolveVariables("{{nome_completo}}", { contactName: "Ana $& Silva" })).toBe("Ana $& Silva");
  });

  test("detecta {{...}} no texto a enviar e monta o aviso de confirmação", () => {
    expect(findUnresolvedVariables("Tudo certo, sem campos")).toEqual([]);
    expect(findUnresolvedVariables("Código {1} e {{ }} vazio")).toEqual([]);
    const fields = findUnresolvedVariables("Visita no {{imovel}}");
    expect(unresolvedWarning(fields)).toBe("Há campos não preenchidos ({{imovel}}). Enviar mesmo assim?");
    expect(unresolvedWarning(["{{a}}", "{{b}}"])).toBe("Há campos não preenchidos ({{a}}, {{b}}). Enviar mesmo assim?");
  });

  test("segmentos separam o que é variável (para destacar)", () => {
    expect(splitVariableSegments("a {{x}} b")).toEqual([
      { text: "a ", variable: false },
      { text: "{{x}}", variable: true },
      { text: " b", variable: false },
    ]);
  });
});

test.describe("inserção na caixa e atalho '/'", () => {
  test("sem cursor conhecido, insere no fim; com cursor, insere na posição", () => {
    expect(insertAtCursor("", undefined, undefined, "Oi", 100)).toEqual({ value: "Oi", caret: 2 });
    expect(insertAtCursor("abc", null, null, "XY", 100)).toEqual({ value: "abcXY", caret: 5 });
    expect(insertAtCursor("abcdef", 3, 3, "XY", 100)).toEqual({ value: "abcXYdef", caret: 5 });
  });

  test("seleção é substituída; índices inválidos são limitados ao texto", () => {
    expect(insertAtCursor("abcdef", 1, 4, "-", 100)).toEqual({ value: "a-ef", caret: 2 });
    expect(insertAtCursor("abc", 99, 99, "Z", 100)).toEqual({ value: "abcZ", caret: 4 });
    expect(insertAtCursor("abc", 3, 1, "Z", 100)).toEqual({ value: "aZ", caret: 2 });
  });

  test("preserva quebras de linha e emojis ao inserir", () => {
    const snippet = "linha 1\n\n• item 😊\n*negrito*";
    expect(insertAtCursor("antes depois", 6, 6, snippet, 4096)?.value).toBe(`antes ${snippet}depois`);
  });

  test("recusa (null) quando passaria do limite, sem cortar nada", () => {
    expect(insertAtCursor("a".repeat(4090), 4090, 4090, "b".repeat(10), 4096)).toBeNull();
    expect(insertAtCursor("a".repeat(4090), 4090, 4090, "b".repeat(6), 4096)?.value.length).toBe(4096);
  });

  test("'/' no início ou depois de espaço aciona; guarda o termo digitado", () => {
    expect(detectSlashTrigger("/", 1)).toEqual({ start: 0, end: 1, query: "" });
    expect(detectSlashTrigger("/vis", 4)).toEqual({ start: 0, end: 4, query: "vis" });
    expect(detectSlashTrigger("Oi /doc", 7)).toEqual({ start: 3, end: 7, query: "doc" });
    expect(detectSlashTrigger("linha\n/loc", 10)).toEqual({ start: 6, end: 10, query: "loc" });
  });

  test("não atrapalha '1/2', 'e/ou', endereços e URLs", () => {
    expect(detectSlashTrigger("1/2", 3)).toBeNull();
    expect(detectSlashTrigger("apto 1/2", 8)).toBeNull();
    expect(detectSlashTrigger("sim e/ou não", 6)).toBeNull();
    expect(detectSlashTrigger("https://site.com/x", 18)).toBeNull();
    expect(detectSlashTrigger("a/b/c", 5)).toBeNull();
  });

  test("a lista fecha ao digitar espaço depois do termo ou quando o cursor sai do termo", () => {
    expect(detectSlashTrigger("/vis ", 5)).toBeNull();
    expect(detectSlashTrigger("/vis texto", 10)).toBeNull();
    expect(detectSlashTrigger("/vis texto", 4)).toEqual({ start: 0, end: 4, query: "vis" });
    expect(detectSlashTrigger("texto sem barra", 5)).toBeNull();
  });

  test("escolher uma resposta substitui '/termo' e deixa o cursor depois do trecho", () => {
    const trigger = detectSlashTrigger("Oi /vis", 7)!;
    expect(replaceSlashTrigger("Oi /vis", trigger, "Visita confirmada\nàs 10h", 4096)).toEqual({
      value: "Oi Visita confirmada\nàs 10h",
      caret: 27,
    });
    const middle = detectSlashTrigger("/vis fim", 4)!;
    expect(replaceSlashTrigger("/vis fim", middle, "TEXTO", 4096)).toEqual({ value: "TEXTO fim", caret: 5 });
    expect(replaceSlashTrigger("/v", detectSlashTrigger("/v", 2)!, "x".repeat(5000), 4096)).toBeNull();
  });
});

test.describe("tamanho da caixa de mensagem", () => {
  test("cresce até 40% da tela e depois rola; expandida chega a 60%", () => {
    expect(composerMaxHeight(900, false)).toBe(360);
    expect(composerMaxHeight(900, true)).toBe(540);
    expect(composerHeight(44, 900, false)).toEqual({ height: 44, scrolls: false });
    expect(composerHeight(200, 900, false)).toEqual({ height: 200, scrolls: false });
    expect(composerHeight(1200, 900, false)).toEqual({ height: 360, scrolls: true });
    expect(composerHeight(1200, 900, true)).toEqual({ height: 540, scrolls: true });
    expect(composerHeight(100, 900, true)).toEqual({ height: 540, scrolls: false });
  });

  test("tela baixa nunca deixa a caixa menor que uma linha", () => {
    expect(composerMaxHeight(60, false)).toBe(44);
    expect(composerHeight(10, 60, false).height).toBe(44);
  });
});

test.describe("busca, filtros e agrupamento", () => {
  const cats: QuickReplyCategory[] = [
    { id: "c-visitas", name: "Visitas", created_by_member_id: "m1" },
    { id: "c-docs", name: "Documentos", created_by_member_id: "m2" },
  ];
  const replies = [
    reply({ id: "1", title: "Confirmar visita", body: "Sábado às 10h", category_id: "c-visitas", use_count: 5, last_used_at: "2026-10-01T10:00:00Z" }),
    reply({ id: "2", title: "Pedir documentos", body: "RG e CPF", category_id: "c-docs", use_count: 9 }),
    reply({ id: "3", title: "Boas-vindas", body: "Olá! Como posso ajudar?", use_count: 0 }),
    reply({ id: "4", title: "Rascunho", body: "visita antiga", is_active: false }),
    reply({ id: "5", title: "Localização", body: "Segue o link", category_id: "apagada" }),
  ];

  test("busca por título ou texto, sem acento e sem maiúsculas; inativas ficam fora", () => {
    expect(normalizeSearch("  VISÍTA ")).toBe("visita");
    expect(filterReplies(replies, "visita", "all").map((r) => r.id)).toEqual(["1"]);
    expect(filterReplies(replies, "cpf", "all").map((r) => r.id)).toEqual(["2"]);
    expect(filterReplies(replies, "", "all").map((r) => r.id)).toEqual(["3", "1", "5", "2"]);
  });

  test("chips: mais usadas (por uso), sem categoria e por categoria", () => {
    expect(filterReplies(replies, "", "top").map((r) => r.id)).toEqual(["2", "1"]);
    expect(filterReplies(replies, "", "none").map((r) => r.id)).toEqual(["3"]);
    expect(filterReplies(replies, "", { categoryId: "c-docs" }).map((r) => r.id)).toEqual(["2"]);
  });

  test("agrupa por categoria; categoria apagada cai em 'Sem categoria'; grupos vazios somem", () => {
    const groups = groupByCategory(filterReplies(replies, "", "all"), cats);
    expect(groups.map((g) => g.category?.name ?? "Sem categoria")).toEqual(["Documentos", "Visitas", "Sem categoria"]);
    expect(groups[2].replies.map((r) => r.id)).toEqual(["3", "5"]);
    expect(groupByCategory(filterReplies(replies, "documentos", "all"), cats).map((g) => g.category?.name)).toEqual(["Documentos"]);
  });

  test("lista do '/': começa-com primeiro, depois contém, depois texto; sem termo, as mais usadas", () => {
    expect(searchForSlash(replies, "").map((r) => r.id)).toEqual(["2", "1", "3", "5"]);
    expect(searchForSlash(replies, "doc").map((r) => r.id)).toEqual(["2"]);
    expect(searchForSlash(replies, "visita").map((r) => r.id)).toEqual(["1"]);
    expect(searchForSlash(replies, "bo").map((r) => r.id)).toEqual(["3"]);
    expect(searchForSlash(replies, "zzz")).toEqual([]);
  });
});

test.describe("permissões e mensagens de erro", () => {
  test("dono gerencia tudo; atendente só o que criou", () => {
    expect(canManageItem({ member_id: "o", role: "owner" }, "outro")).toBe(true);
    expect(canManageItem({ member_id: "a", role: "attendant" }, "a")).toBe(true);
    expect(canManageItem({ member_id: "a", role: "attendant" }, "b")).toBe(false);
  });

  test("erros do banco viram mensagens em português; o desconhecido não vaza detalhe", () => {
    expect(quickReplyErrorMessage({ message: "quick_reply_not_authorized" })).toMatch(/permissão/);
    expect(quickReplyErrorMessage(new Error("quick_reply_category_duplicate"))).toBe("Já existe uma categoria com esse nome.");
    expect(quickReplyErrorMessage("quick_reply_title_invalid")).toBe("O título deve ter de 1 a 60 caracteres.");
    expect(quickReplyErrorMessage({ message: 'new row violates check (Failing row contains (segredo))' })).toBe(
      "Não foi possível concluir. Tente novamente.",
    );
    expect(quickReplyErrorMessage(null)).toBe("Não foi possível concluir. Tente novamente.");
  });
});

test.describe("imagem na conversa", () => {
  test("a foto usa o limite no maior lado (180 px celular, 220 px desktop) tanto na altura quanto na largura", () => {
    expect(IMAGE_MAX_SIDE_MOBILE_PX).toBe(180);
    expect(IMAGE_MAX_SIDE_DESKTOP_PX).toBe(220);
    const source = readFileSync("components/conversations/attachment-view.tsx", "utf8");
    expect(source).toContain(`max-h-[${IMAGE_MAX_SIDE_MOBILE_PX}px]`);
    expect(source).toContain(`max-w-[${IMAGE_MAX_SIDE_MOBILE_PX}px]`);
    expect(source).toContain(`sm:max-h-[${IMAGE_MAX_SIDE_DESKTOP_PX}px]`);
    expect(source).toContain(`sm:max-w-[${IMAGE_MAX_SIDE_DESKTOP_PX}px]`);
    // O vídeo usa o mesmo limite (duas ocorrências de cada classe: foto e vídeo).
    expect(source.split(`max-h-[${IMAGE_MAX_SIDE_MOBILE_PX}px]`).length - 1).toBeGreaterThanOrEqual(2);
    expect(source.split(`sm:max-w-[${IMAGE_MAX_SIDE_DESKTOP_PX}px]`).length - 1).toBeGreaterThanOrEqual(2);
  });
});
