import { expect, test } from "@playwright/test";
import { REINVITE_SUCCESS_MESSAGE, friendlyTeamError } from "../lib/team/errors";

test.describe("Equipe: mensagens de erro", () => {
  test("cada erro conhecido do banco vira mensagem em português, sem o código técnico", () => {
    const codes = [
      "team_member_already_active",
      "team_invitation_already_pending",
      "team_identity_unavailable",
      "team_member_not_removable",
      "team_member_inactive",
    ];
    const messages = codes.map((code) => friendlyTeamError(`erro: ${code}`));
    for (const [index, message] of messages.entries()) {
      expect(message).not.toContain(codes[index]);
      expect(message.length).toBeGreaterThan(15);
    }
    expect(new Set(messages).size).toBe(codes.length); // mensagens distintas
  });

  test("e-mail de outra conta ativa/desativada explica o motivo", () => {
    expect(friendlyTeamError("team_identity_unavailable")).toContain("outro workspace");
  });

  test("erro desconhecido ou vazio cai na mensagem genérica", () => {
    expect(friendlyTeamError("algo inesperado")).toContain("Tente novamente");
    expect(friendlyTeamError(null)).toContain("Tente novamente");
    expect(friendlyTeamError(undefined)).toContain("Tente novamente");
  });

  test("reconvite de quem já tinha acesso: texto de sucesso explica o e-mail enviado", () => {
    expect(REINVITE_SUCCESS_MESSAGE).toContain("já tinha acesso");
  });
});
