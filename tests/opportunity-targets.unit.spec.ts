import { expect, test } from "@playwright/test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolveOpportunityTargets } from "@/lib/conversations/opportunity-targets";

// IDs de produção são gerados por workspace: usar sempre dados reais, nunca IDs de seed.
const REAL_STAGES = [{ id: "d3b0b8a2-6f5e-4c1a-9e57-0c1f2a9b7e11" }, { id: "0a7c1f44-2b9d-4a67-8d3e-5f6e7a8b9c10" }];
const REAL_CONTACT = "9c2e4b1a-7d3f-4e58-b6a1-2f3e4d5c6b7a";

test("usa a primeira etapa real (menor posição) e o contato real da conversa", () => {
  expect(resolveOpportunityTargets(REAL_STAGES, REAL_CONTACT)).toEqual({
    ok: true,
    stageId: REAL_STAGES[0].id,
    contactId: REAL_CONTACT,
  });
});

test("sem contato vinculado falha com mensagem clara e não inventa um contato", () => {
  for (const contact of [null, undefined, ""]) {
    const result = resolveOpportunityTargets(REAL_STAGES, contact);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("não está vinculada a um contato");
  }
});

test("sem etapas carregadas falha com mensagem clara e não inventa uma etapa", () => {
  for (const stages of [undefined, []]) {
    const result = resolveOpportunityTargets(stages, REAL_CONTACT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("etapas do Kanban");
  }
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

test("código de produção não contém UUIDs de seed (41000000-… / 51000000-…)", () => {
  const seedId = /\b[0-9a-f]{2}000000-0000-4000-8000-0000000000[0-9a-f]{2}\b/i;
  const offenders = ["app", "components", "lib"]
    .flatMap((dir) => sourceFiles(join(process.cwd(), dir)))
    .filter((file) => seedId.test(readFileSync(file, "utf8")));
  expect(offenders).toEqual([]);
});
