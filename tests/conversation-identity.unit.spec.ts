import { expect, test } from "@playwright/test";
import { resolveConversationIdentity } from "@/lib/conversations/identity";

test.describe("Identidade do cabeçalho de conversas", () => {
  test("mantém o nome CRM em conversa ativa", () => {
    expect(
      resolveConversationIdentity({
        contactDisplayName: "Vanessa Cristina Andrade",
        conversationType: "individual",
        externalDisplayName: "Vanessa do WhatsApp",
        phoneDisplayValue: "(82) 99999-0020",
      }),
    ).toBe("Vanessa Cristina Andrade");
  });

  test("mantém o nome CRM em conversa arquivada", () => {
    expect(
      resolveConversationIdentity({
        contactDisplayName: "Vanessa Cristina Andrade",
        conversationType: "individual",
        externalDisplayName: "Vanessa do WhatsApp",
        phoneDisplayValue: "(82) 99999-0020",
      }),
    ).toBe("Vanessa Cristina Andrade");
  });

  test("usa identidade externa quando não há contato CRM", () => {
    expect(
      resolveConversationIdentity({
        conversationType: "individual",
        externalDisplayName: "Vanessa do WhatsApp",
        phoneDisplayValue: "(82) 99999-0020",
      }),
    ).toBe("Vanessa do WhatsApp");
  });

  test("usa telefone formatado quando não há nome", () => {
    expect(
      resolveConversationIdentity({
        conversationType: "individual",
        normalizedPhone: "+5582999990020",
      }),
    ).toBe("(82) 99999-0020");
  });

  test("mantém a regra própria de grupos", () => {
    expect(
      resolveConversationIdentity({
        contactDisplayName: "Contato CRM",
        conversationType: "group",
        externalDisplayName: "Push name",
        groupSubject: "Grupo de clientes",
      }),
    ).toBe("Grupo de clientes");
  });
});
