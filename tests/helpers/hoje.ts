import type { Page } from "@playwright/test";

/** Abre todos os "Ver mais" de uma seção do Hoje (as listas mostram só os primeiros itens, do mais antigo ao mais novo). */
export async function expandSection(page: Page, testId: string) {
  const section = page.getByTestId(testId);
  const buttons = section.getByTestId("hoje-see-more");
  for (let index = 0; index < 5; index += 1) {
    const collapsed = section.locator('[data-testid="hoje-see-more"][aria-expanded="false"]');
    if ((await collapsed.count()) === 0) break;
    await collapsed.first().click();
  }
  return buttons;
}
