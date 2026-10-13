import { expect, test } from "@playwright/test";
import { passwordUpdateErrorMessage } from "../lib/auth/password-errors";

test.describe("Convite: erro ao definir a senha", () => {
  test("senha igual à anterior (reconvite) tem mensagem própria", () => {
    expect(passwordUpdateErrorMessage({ code: "same_password", message: "x" })).toContain("diferente da anterior");
    expect(passwordUpdateErrorMessage({ message: "New password should be different from the old password." })).toContain("diferente da anterior");
  });

  test("qualquer outro erro continua genérico, sem detalhes do Auth", () => {
    for (const error of [{ code: "weak_password", message: "Password is known to be weak" }, { message: "boom" }, null, undefined, {}]) {
      const message = passwordUpdateErrorMessage(error);
      expect(message).toBe("Não foi possível definir sua senha. Tente novamente.");
    }
  });
});
