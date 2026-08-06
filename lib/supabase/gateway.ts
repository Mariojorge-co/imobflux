import "server-only";

export type SendEvolutionTextMessageResult =
  | { success: true; externalMessageId: string }
  | { success: false; error: string; code: string };

/**
 * Normaliza e formata o telefone para o padrão numérico esperado pela Evolution API (ex: 5582988880000).
 */
export function formatPhoneForEvolution(toPhone: string): string | null {
  if (!toPhone || typeof toPhone !== "string") {
    return null;
  }

  const digits = toPhone.replace(/\D/g, "");
  if (!digits) {
    return null;
  }

  // 10 ou 11 dígitos nacionais (ex: 82999990000) -> adicionar código do país 55
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }

  // 12 ou 13 dígitos com DDI 55 (ex: 5582999990000)
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    return digits;
  }

  return null;
}

/**
 * Envia uma mensagem de texto simples para um destinatário através da Evolution API v2.
 */
export async function sendEvolutionTextMessage(
  instanceName?: string,
  toPhone?: string,
  textContent?: string,
  timeoutMs = 10000,
): Promise<SendEvolutionTextMessageResult> {
  const apiUrl = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;

  if (!apiUrl || !apiKey) {
    return {
      success: false,
      error: "Configuração da Evolution API ausente no ambiente",
      code: "MISSING_ENV_CONFIG",
    };
  }

  const activeInstance = instanceName?.trim() || process.env.EVOLUTION_INSTANCE_NAME?.trim();
  if (!activeInstance) {
    return {
      success: false,
      error: "Nome da instância do WhatsApp não informado",
      code: "MISSING_INSTANCE",
    };
  }

  if (!textContent || typeof textContent !== "string" || textContent.trim() === "") {
    return {
      success: false,
      error: "Conteúdo da mensagem não pode ser vazio",
      code: "EMPTY_TEXT",
    };
  }

  if (!toPhone || typeof toPhone !== "string") {
    return {
      success: false,
      error: "Telefone do destinatário não informado",
      code: "INVALID_PHONE",
    };
  }

  const formattedPhone = formatPhoneForEvolution(toPhone);
  if (!formattedPhone) {
    return {
      success: false,
      error: "Telefone do destinatário inválido",
      code: "INVALID_PHONE",
    };
  }

  const baseUrl = apiUrl.replace(/\/+$/, "");
  const targetUrl = `${baseUrl}/message/sendText/${activeInstance}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: apiKey,
      },
      body: JSON.stringify({
        number: formattedPhone,
        textMessage: {
          text: textContent,
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      return {
        success: false,
        error: `Evolution API retornou erro HTTP ${response.status}`,
        code: `HTTP_${response.status}`,
      };
    }

    let responseData: unknown;
    try {
      responseData = await response.json();
    } catch {
      return {
        success: false,
        error: "Resposta da Evolution API não é um JSON válido",
        code: "INVALID_JSON_RESPONSE",
      };
    }

    const payload = responseData as { key?: { id?: string } };
    const externalMessageId = payload?.key?.id;

    if (!externalMessageId || typeof externalMessageId !== "string") {
      return {
        success: false,
        error: "Resposta da Evolution API não continha o ID externo da mensagem",
        code: "MISSING_EXTERNAL_ID",
      };
    }

    return {
      success: true,
      externalMessageId,
    };
  } catch (err: unknown) {
    clearTimeout(timer);

    if (err instanceof Error && err.name === "AbortError") {
      return {
        success: false,
        error: "Tempo limite excedido no envio da mensagem",
        code: "TIMEOUT",
      };
    }

    return {
      success: false,
      error: "Falha de rede na comunicação com a Evolution API",
      code: "NETWORK_ERROR",
    };
  }
}
