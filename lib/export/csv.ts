/** Gerador de CSV para planilhas em português (Excel pt-BR): separador ";", UTF-8 com BOM e quebras CRLF. */

export type CsvColumn<Row> = {
  header: string;
  value: (row: Row) => unknown;
};

const SEPARATOR = ";";
const NEWLINE = "\r\n";
const BOM = "﻿";

const ZONE = "America/Maceio"; // UTC-3 o ano todo

const dateTimeFormat = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: ZONE,
});

/** ISO 8601 -> "13/10/2026 09:30" (horário de Maceió). Valor ausente ou inválido vira texto vazio. */
export function formatDateTime(value: unknown): string {
  if (typeof value !== "string" || value === "") return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : dateTimeFormat.format(date).replace(",", "");
}

export function formatYesNo(value: unknown): string {
  return value === true ? "Sim" : value === false ? "Não" : "";
}

/**
 * Neutraliza "injeção de fórmula": planilhas executam células que começam com = + - @ (ou tab/CR).
 * Dados vêm de terceiros (nome de contato no WhatsApp, por exemplo), então a célula ganha um apóstrofo.
 */
export function neutralizeFormula(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

/** Uma célula pronta: texto seguro, entre aspas quando necessário. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = neutralizeFormula(typeof value === "string" ? value : String(value));
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildCsv<Row>(columns: Array<CsvColumn<Row>>, rows: Row[]): string {
  const header = columns.map((column) => csvCell(column.header)).join(SEPARATOR);
  const lines = rows.map((row) => columns.map((column) => csvCell(column.value(row))).join(SEPARATOR));
  return BOM + [header, ...lines].join(NEWLINE) + NEWLINE;
}

/** AAAA-MM-DD no horário de Maceió, para o nome do arquivo. */
export function fileDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: ZONE }).format(now);
  return parts;
}
