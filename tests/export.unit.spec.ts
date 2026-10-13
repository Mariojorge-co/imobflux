import "./helpers/server-only";

import { expect, test } from "@playwright/test";
import { buildCsv, csvCell, fileDate, formatDateTime, formatYesNo, neutralizeFormula } from "../lib/export/csv";
import { EXPORTS, EXPORT_ROW_LIMIT, exportBySlug, truncationNotice } from "../lib/export/datasets";

/* eslint-disable @typescript-eslint/no-require-imports */
const serverModule = require("@/lib/supabase/server");
const exportRoute = require("@/app/api/export/[kind]/route") as typeof import("@/app/api/export/[kind]/route");
const { GET } = exportRoute;
/* eslint-enable @typescript-eslint/no-require-imports */

test.describe("Exportação: CSV seguro", () => {
  test("células: aspas, ponto e vírgula e quebras de linha são protegidos", () => {
    expect(csvCell("Maria")).toBe("Maria");
    expect(csvCell("Silva; Souza")).toBe('"Silva; Souza"');
    expect(csvCell('Ele disse "oi"')).toBe('"Ele disse ""oi"""');
    expect(csvCell("linha1\nlinha2")).toBe('"linha1\nlinha2"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(42)).toBe("42");
  });

  test("injeção de fórmula: células que começam com = + - @ ganham apóstrofo", () => {
    for (const dangerous of ["=1+1", "+5511999999999", "-2+3", "@SOMA(A1)", "\tcmd", "=HYPERLINK(\"http://x\")"]) {
      expect(neutralizeFormula(dangerous).startsWith("'")).toBe(true);
    }
    expect(neutralizeFormula("Maria")).toBe("Maria");
    expect(neutralizeFormula("1+1")).toBe("1+1");
    expect(csvCell("=cmd|' /C calc'!A0")).toBe("'=cmd|' /C calc'!A0");
  });

  test("arquivo: BOM, cabeçalho, separador ';' e CRLF", () => {
    const csv = buildCsv(
      [{ header: "Nome", value: (row: { n: string }) => row.n }, { header: "Obs", value: () => "a;b" }],
      [{ n: "Ana" }, { n: "=1+1" }],
    );
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toBe("﻿Nome;Obs\r\nAna;\"a;b\"\r\n'=1+1;\"a;b\"\r\n");
  });

  test("datas em horário de Maceió (UTC-3), booleanos em Sim/Não", () => {
    expect(formatDateTime("2026-10-13T12:30:00.000Z")).toBe("13/10/2026 09:30");
    expect(formatDateTime("2026-10-13T02:00:00.000Z")).toBe("12/10/2026 23:00");
    expect(formatDateTime("lixo")).toBe("");
    expect(formatDateTime(null)).toBe("");
    expect(formatYesNo(true)).toBe("Sim");
    expect(formatYesNo(false)).toBe("Não");
    expect(formatYesNo(null)).toBe("");
    expect(fileDate(new Date("2026-10-13T02:00:00.000Z"))).toBe("2026-10-12");
  });
});

test.describe("Exportação: colunas", () => {
  test("contatos: traduz classificação/situação e marca protegido", () => {
    const row = { display_name: "Ana", classification: "lead", operational_status: "inactive", registration_status: "provisional", is_protected: true, phones: "(82) 99999-0000 | (82) 98888-0000", created_at: "2026-10-13T12:30:00.000Z", archived_at: null };
    const csv = buildCsv(EXPORTS.contatos.columns, [row]);
    const [header, line] = csv.replace("﻿", "").split("\r\n");
    expect(header).toBe("Nome;Classificação;Situação;Cadastro;Protegido;Telefones;Criado em;Atualizado em;Arquivado em");
    expect(line).toBe("Ana;Lead;Inativo;Provisório;Sim;(82) 99999-0000 | (82) 98888-0000;13/10/2026 09:30;;");
  });

  test("oportunidades: nomes no lugar de ids e situação em português", () => {
    const row = { title: "Apto", contact_name: "Ana", stage_name: "Visita", status: "won", responsible_name: "Bruno", origin: "Instagram" };
    const line = buildCsv(EXPORTS.oportunidades.columns, [row]).split("\r\n")[1];
    expect(line.startsWith("Apto;Ana;Visita;Ganha;Bruno;Instagram;")).toBe(true);
  });

  test("nenhuma coluna exporta dado financeiro sensível, descrição privada ou ids internos", () => {
    const headers = [...EXPORTS.contatos.columns, ...EXPORTS.oportunidades.columns].map((column) => column.header.toLowerCase());
    for (const forbidden of ["renda", "aprovado", "financeir", "comiss", "descri", "id"]) {
      expect(headers.some((header) => header === forbidden || header.includes(forbidden) && forbidden !== "id")).toBe(false);
    }
  });

  test("slugs: só os conhecidos (sem herdar propriedades do protótipo)", () => {
    expect(exportBySlug("contatos")?.kind).toBe("contacts");
    expect(exportBySlug("oportunidades")?.kind).toBe("opportunities");
    expect(exportBySlug("mensagens")).toBeNull();
    expect(exportBySlug("__proto__")).toBeNull();
    expect(exportBySlug("constructor")).toBeNull();
  });
});

let user: { id: string } | null;
let rpcResult: { data: unknown; error: { code?: string; message?: string } | null };
let rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;

const call = (slug: string, headers: Record<string, string> = {}) =>
  GET(new Request(`http://app.test/api/export/${slug}`, { headers }), { params: Promise.resolve({ kind: slug }) });

test.describe("Exportação: rota", () => {
  test.beforeEach(() => {
    user = { id: "u1" };
    rpcCalls = [];
    rpcResult = { data: { success: true, rows: [{ display_name: "Ana", is_protected: false }], truncated: false }, error: null };
    serverModule.createServerSupabaseClient = async () => ({
      auth: { getUser: async () => ({ data: { user } }) },
      rpc: async (fn: string, args: Record<string, unknown>) => { rpcCalls.push({ fn, args }); return rpcResult; },
    });
  });

  test("OWNER: baixa o CSV com cabeçalhos seguros", async () => {
    const response = await call("contatos");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="contatos-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-export-truncated")).toBeNull();
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM UTF-8 (o Excel precisa dele para os acentos)
    const body = await response.text(); // text() descarta o BOM ao decodificar
    expect(body.startsWith("Nome;")).toBe(true);
    expect(body).toContain("Ana;");
    expect(rpcCalls).toEqual([{ fn: "export_dataset", args: { p_kind: "contacts" } }]);
  });

  test("oportunidades usam o tipo certo; truncamento é sinalizado", async () => {
    rpcResult = { data: { success: true, rows: [], truncated: true }, error: null };
    const response = await call("oportunidades");
    expect(response.status).toBe(200);
    expect(response.headers.get("x-export-truncated")).toBe("true");
    expect(rpcCalls[0].args).toEqual({ p_kind: "opportunities" });
  });

  test("ATTENDANT: o banco nega, a rota devolve 403 sem arquivo", async () => {
    rpcResult = { data: { success: false, error: "forbidden" }, error: null };
    const response = await call("contatos");
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-disposition")).toBeNull();
    expect(await response.text()).not.toContain("Ana");
  });

  test("sem sessão: 401 e o banco nem é consultado", async () => {
    user = null;
    expect((await call("contatos")).status).toBe(401);
    expect(rpcCalls).toHaveLength(0);
  });

  test("sessão sem vínculo ativo (42501): 401", async () => {
    rpcResult = { data: null, error: { code: "42501", message: "resource_not_available" } };
    expect((await call("contatos")).status).toBe(401);
  });

  test("falha do banco: 500 genérico, sem detalhes", async () => {
    rpcResult = { data: null, error: { code: "XX000", message: "detalhe interno do banco" } };
    const response = await call("contatos");
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("detalhe interno");
  });

  test("tipo desconhecido: 404 sem consultar o banco", async () => {
    expect((await call("mensagens")).status).toBe(404);
    expect((await call("__proto__")).status).toBe(404);
    expect(rpcCalls).toHaveLength(0);
  });

  test("pedido vindo de outro site (cross-site) é recusado; mesma origem e navegação direta passam", async () => {
    expect((await call("contatos", { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await call("contatos", { "sec-fetch-site": "same-site" })).status).toBe(403);
    expect(rpcCalls).toHaveLength(0);
    expect((await call("contatos", { "sec-fetch-site": "same-origin" })).status).toBe(200);
    expect((await call("contatos", { "sec-fetch-site": "none" })).status).toBe(200);
  });
});

test.describe("Exportação: teto de linhas e aviso", () => {
  test("o teto do app é igual ao do banco (5.000)", () => {
    expect(EXPORT_ROW_LIMIT).toBe(5000);
  });

  test("aviso aparece só quando o total passa do teto, com os números em português", () => {
    expect(truncationNotice(null)).toBeNull();
    expect(truncationNotice(0)).toBeNull();
    expect(truncationNotice(5000)).toBeNull();
    const notice = truncationNotice(7200);
    expect(notice).toContain("7.200");
    expect(notice).toContain("5.000");
    expect(notice).toContain("2.200");
    expect(notice).toContain("mais antigos");
  });

  test("a rota define maxDuration", () => {
    expect(exportRoute.maxDuration).toBe(30);
  });
});
