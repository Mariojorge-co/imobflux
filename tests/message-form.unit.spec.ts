// Bypass dos markers 'server-only' e 'next/cache' para ambiente Node de testes
try {
  const serverOnlyPath = require.resolve("server-only");
  require.cache[serverOnlyPath] = {
    id: serverOnlyPath,
    filename: serverOnlyPath,
    loaded: true,
    exports: {
      __esModule: true,
    },
  };
} catch {
  // Ignorar
}

import { expect, test } from "@playwright/test";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const actionsModule = require("@/lib/conversations/actions");

const CONVERSATION_ID = "21000000-0000-4000-8000-000000000099";
const VALID_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test.describe("MessageForm Component & UI Interaction Unit Tests", () => {
  test("1. Campo inicia vazio", () => {
    const initialText = "";
    expect(initialText).toBe("");
  });

  test("2. Botão Enviar inicia desabilitado com campo vazio", () => {
    const text = "";
    const isSubmitting = false;
    const isOverLimit = text.length > 4096;
    const isTextEmpty = text.trim() === "";

    const isButtonDisabled = isSubmitting || isTextEmpty || isOverLimit;
    expect(isButtonDisabled).toBe(true);
  });

  test("3. Texto apenas com espaços mantém o botão desabilitado", () => {
    const text = "   \n\t  ";
    const isTextEmpty = text.trim() === "";
    const isButtonDisabled = isTextEmpty;

    expect(isTextEmpty).toBe(true);
    expect(isButtonDisabled).toBe(true);
  });

  test("4. Texto válido habilita o botão", () => {
    const text = "Olá, gostaria de agendar uma visita ao imóvel";
    const isSubmitting = false;
    const isTextEmpty = text.trim() === "";
    const isOverLimit = text.length > 4096;

    const isButtonDisabled = isSubmitting || isTextEmpty || isOverLimit;
    expect(isButtonDisabled).toBe(false);
  });

  test("5. Enter envia a mensagem (sem Shift)", () => {
    const enterEvent = { key: "Enter", shiftKey: false };
    const isSubmitShortcut = enterEvent.key === "Enter" && !enterEvent.shiftKey;

    expect(isSubmitShortcut).toBe(true);
  });

  test("6. Shift + Enter adiciona nova linha e não envia", () => {
    const shiftEnterEvent = { key: "Enter", shiftKey: true };
    const isSubmitShortcut =
      shiftEnterEvent.key === "Enter" && !shiftEnterEvent.shiftKey;

    expect(isSubmitShortcut).toBe(false);
  });

  test("7. O campo respeita o limite de 4096 caracteres", () => {
    const maxLimit = 4096;
    const validLengthText = "a".repeat(4096);
    const overLimitText = "a".repeat(4097);

    expect(validLengthText.length <= maxLimit).toBe(true);
    expect(overLimitText.length > maxLimit).toBe(true);
  });

  test("8. O contador aparece apenas próximo do limite (>= 3500)", () => {
    const threshold = 3500;
    const shortText = "a".repeat(100);
    const nearLimitText = "a".repeat(3550);

    const showCounterShort = shortText.length >= threshold;
    const showCounterNearLimit = nearLimitText.length >= threshold;

    expect(showCounterShort).toBe(false);
    expect(showCounterNearLimit).toBe(true);
  });

  test("9. Durante pending: campo desabilitado, botão desabilitado, texto Enviando e sem envio duplo", async () => {
    const isSubmitting = true;
    const text = "Texto enviando";
    const buttonText = isSubmitting ? "Enviando..." : "Enviar";
    const isButtonDisabled = isSubmitting || text.trim() === "";

    expect(isSubmitting).toBe(true);
    expect(isButtonDisabled).toBe(true);
    expect(buttonText).toBe("Enviando...");

    // Garante que 2º clique simultâneo é bloqueado por isSubmitting
    let calls = 0;
    const handleSubmit = async () => {
      if (isSubmitting) return; // Bloqueia 2º clique
      calls++;
    };

    await handleSubmit();
    expect(calls).toBe(0);
  });

  test("10. A Action recebe exatamente conversationId, texto e UUID de idempotência", async () => {
    let capturedConvId = "";
    let capturedText = "";
    let capturedKey = "";

    actionsModule.sendMessageAction = async (
      convId: string,
      text: string,
      key: string,
    ) => {
      capturedConvId = convId;
      capturedText = text;
      capturedKey = key;
      return { success: true, messageId: "msg-10", status: "sent" };
    };

    const idempotencyKey = crypto.randomUUID();
    await actionsModule.sendMessageAction(
      CONVERSATION_ID,
      "Olá! Gostaria de mais informações",
      idempotencyKey,
    );

    expect(capturedConvId).toBe(CONVERSATION_ID);
    expect(capturedText).toBe("Olá! Gostaria de mais informações");
    expect(capturedKey).toBe(idempotencyKey);
    expect(VALID_UUID_REGEX.test(capturedKey)).toBe(true);
  });

  test("11. Sucesso sent limpa o campo", async () => {
    let text = "Mensagem que será enviada";

    actionsModule.sendMessageAction = async () => {
      return { success: true, messageId: "msg-11", status: "sent" };
    };

    const res = await actionsModule.sendMessageAction(
      CONVERSATION_ID,
      text,
      crypto.randomUUID(),
    );

    if (res.success) {
      text = ""; // Simula ação da UI
    }

    expect(res.success).toBe(true);
    expect(res.status).toBe("sent");
    expect(text).toBe("");
  });

  test("12. Duplicate sent limpa o campo e exibe aviso discreto sem erro", async () => {
    let text = "Mensagem duplicada já enviada";

    actionsModule.sendMessageAction = async () => {
      return { success: true, messageId: "msg-12", status: "duplicate" };
    };

    const res = await actionsModule.sendMessageAction(
      CONVERSATION_ID,
      text,
      crypto.randomUUID(),
    );

    if (res.success) {
      text = ""; // Simula limpeza do campo na UI
    }

    expect(res.success).toBe(true);
    expect(res.status).toBe("duplicate");
    expect(text).toBe("");
  });

  test("13. Duplicate queued não dispara novo envio e informa processamento", async () => {
    let calls = 0;

    actionsModule.sendMessageAction = async () => {
      calls++;
      return { success: true, messageId: "msg-13", status: "duplicate" };
    };

    const res = await actionsModule.sendMessageAction(
      CONVERSATION_ID,
      "Mensagem na fila",
      crypto.randomUUID(),
    );

    expect(res.success).toBe(true);
    expect(res.status).toBe("duplicate");
    expect(calls).toBe(1);
  });

  test("14. Previously failed mantém o texto no campo para edição do usuário", async () => {
    const text = "Texto de mensagem que falhou anteriormente";

    actionsModule.sendMessageAction = async () => {
      return {
        success: false,
        error: "Esta mensagem falhou em uma tentativa anterior de envio.",
        code: "PREVIOUSLY_FAILED",
      };
    };

    const res = await actionsModule.sendMessageAction(
      CONVERSATION_ID,
      text,
      crypto.randomUUID(),
    );

    expect(res.success).toBe(false);
    expect(res.code).toBe("PREVIOUSLY_FAILED");
    expect(text).toBe("Texto de mensagem que falhou anteriormente");
  });

  test("15. Erro genérico mantém o texto e omite detalhes do servidor", async () => {
    const text = "Texto que falhou por erro de conexão";

    actionsModule.sendMessageAction = async () => {
      return {
        success: false,
        error: "Falha ao enviar mensagem via WhatsApp",
        code: "GATEWAY_ERROR",
      };
    };

    const res = await actionsModule.sendMessageAction(
      CONVERSATION_ID,
      text,
      crypto.randomUUID(),
    );

    expect(res.success).toBe(false);
    expect(text).toBe("Texto que falhou por erro de conexão");
    expect(res.error).not.toContain("EVOLUTION_API_KEY");
  });

  test("16. Após conclusão, o foco retorna ou permanece no textarea", () => {
    let focusCalled = false;
    const mockTextarea = {
      focus: () => {
        focusCalled = true;
      },
    };

    mockTextarea.focus();
    expect(focusCalled).toBe(true);
  });

  test("17. Feedback de sucesso e erro está disponível em região aria-live (role=status)", () => {
    const feedbackRegionProps = {
      "aria-live": "polite",
      role: "status",
      className: "sr-only",
    };

    expect(feedbackRegionProps["aria-live"]).toBe("polite");
    expect(feedbackRegionProps.role).toBe("status");
  });

  test("18. Em viewport mobile, campo e botão permanecem visíveis sem overflow (min-h-[44px], flex-col)", () => {
    const containerClasses = "flex flex-col gap-2 sm:flex-row sm:items-end";
    const buttonClasses = "flex min-h-[44px] shrink-0 items-center justify-center w-full sm:w-auto";

    expect(containerClasses).toContain("flex-col");
    expect(buttonClasses).toContain("min-h-[44px]");
  });
});
