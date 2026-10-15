import "server-only";

export type SendEvolutionTextMessageResult =
  | { success: true; externalMessageId: string }
  | { success: false; error: string; code: string };

/**
 * Formata o destino no padrão numérico esperado pela Evolution API (ex: 5582988880000).
 *
 * Aceita dois formatos de entrada:
 * - JID do WhatsApp (o que a conversa guarda em external_thread_id, ex.: "5582988880000@s.whatsapp.net"
 *   ou "5582988880000:12@s.whatsapp.net"): o JID JÁ traz o código do país, então os dígitos são usados
 *   como vieram. Isso preserva o celular antigo sem o 9º dígito (12 dígitos) e números internacionais de
 *   10/11 dígitos (ex.: EUA), que NÃO podem ganhar o prefixo 55. Grupo, lista de transmissão, canal e
 *   identificador @lid não são destinos individuais: devolvem null.
 * - Telefone digitado (com ou sem máscara): 10/11 dígitos nacionais ganham o 55; 12/13 com 55 passam como estão.
 */
export function formatPhoneForEvolution(toPhone: string): string | null {
  if (!toPhone || typeof toPhone !== "string") {
    return null;
  }

  const at = toPhone.indexOf("@");
  if (at >= 0) {
    const domain = toPhone.slice(at + 1).trim().toLowerCase();
    if (domain !== "s.whatsapp.net" && domain !== "c.us") {
      return null;
    }
    const local = toPhone.slice(0, at).split(":")[0].trim();
    return /^[1-9][0-9]{7,14}$/.test(local) ? local : null;
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

/** Identificador externo devolvido pela Evolution v2: `key.id` (aceita também o envelope `data.key.id`). */
function externalIdFrom(responseData: unknown): string | null {
  const payload = responseData as { key?: { id?: unknown }; data?: { key?: { id?: unknown } } } | null;
  const id = payload?.key?.id ?? payload?.data?.key?.id;
  return typeof id === "string" && id.trim() !== "" ? id : null;
}

/**
 * Envia uma mensagem de texto simples para um destinatário através da Evolution API v2.
 * Contrato v2: POST /message/sendText/{instância} com `{ number, text }` e resposta com `key.id`.
 *
 * Os erros devolvem só um código curto (`HTTP_<status>`, `TIMEOUT`, ...) e uma frase fixa: nunca o corpo
 * da resposta da Evolution, o texto da mensagem, o número, a chave de acesso nem o endereço do servidor.
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

  // O nome da instância vem da conexão do workspace (resolvida pelo chamador); a variável de ambiente
  // EVOLUTION_INSTANCE_NAME é só reserva.
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
  const targetUrl = `${baseUrl}/message/sendText/${encodeURIComponent(activeInstance)}`;

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
        text: textContent,
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

    const externalMessageId = externalIdFrom(responseData);
    if (!externalMessageId) {
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

export type SendEvolutionMediaInput = {
  /** image | video | audio | document (imagem "como documento" vai como document, sem compressão). */
  mediatype: "image" | "video" | "audio" | "document";
  mimetype: string;
  fileName: string;
  caption?: string | null;
  /** URL assinada de vida curta do arquivo no Storage privado (a Evolution baixa por ela). Nunca vai para log. */
  mediaUrl: string;
};

/**
 * Envia um arquivo pela Evolution API v2: POST /message/sendMedia/{instância} com
 * `{ number, mediatype, mimetype, fileName, caption?, media }`, onde `media` é a URL (ou base64) e a resposta traz
 * `key.id`. Confirmado no código da v2.3.7 (SendMediaDto/mediaMessageSchema). A imagem enviada como "image" é
 * recomprimida em JPEG pela própria Evolution; por isso o "enviar como documento" usa mediatype "document".
 *
 * Como no texto, os erros devolvem só um código curto e uma frase fixa: nunca a URL assinada, o nome do arquivo, o
 * número, o corpo da resposta nem a chave.
 */
export async function sendEvolutionMedia(
  instanceName: string | undefined,
  toPhone: string | undefined,
  input: SendEvolutionMediaInput,
  timeoutMs = 60000,
): Promise<SendEvolutionTextMessageResult> {
  const apiUrl = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;
  if (!apiUrl || !apiKey) {
    return { success: false, error: "Configuração da Evolution API ausente no ambiente", code: "MISSING_ENV_CONFIG" };
  }

  const activeInstance = instanceName?.trim() || process.env.EVOLUTION_INSTANCE_NAME?.trim();
  if (!activeInstance) {
    return { success: false, error: "Nome da instância do WhatsApp não informado", code: "MISSING_INSTANCE" };
  }

  const formattedPhone = toPhone ? formatPhoneForEvolution(toPhone) : null;
  if (!formattedPhone) {
    return { success: false, error: "Telefone do destinatário inválido", code: "INVALID_PHONE" };
  }

  const targetUrl = `${apiUrl.replace(/\/+$/, "")}/message/sendMedia/${encodeURIComponent(activeInstance)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const caption = input.caption?.trim();
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: apiKey },
      body: JSON.stringify({
        number: formattedPhone,
        mediatype: input.mediatype,
        mimetype: input.mimetype,
        fileName: input.fileName,
        ...(caption ? { caption } : {}),
        media: input.mediaUrl,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      return { success: false, error: `Evolution API retornou erro HTTP ${response.status}`, code: `HTTP_${response.status}` };
    }

    let responseData: unknown;
    try {
      responseData = await response.json();
    } catch {
      return { success: false, error: "Resposta da Evolution API não é um JSON válido", code: "INVALID_JSON_RESPONSE" };
    }

    const externalMessageId = externalIdFrom(responseData);
    if (!externalMessageId) {
      return { success: false, error: "Resposta da Evolution API não continha o ID externo da mensagem", code: "MISSING_EXTERNAL_ID" };
    }
    return { success: true, externalMessageId };
  } catch (err: unknown) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      return { success: false, error: "Tempo limite excedido no envio do arquivo", code: "TIMEOUT" };
    }
    return { success: false, error: "Falha de rede na comunicação com a Evolution API", code: "NETWORK_ERROR" };
  }
}
