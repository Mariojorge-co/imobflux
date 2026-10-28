import http from "node:http";

// Evolution API SIMULADA para os testes de navegador: nada sai para a internet nem usa credencial real.
// Registra o que o app enviaria (caminho e corpo, sem a chave) e responde no formato da Evolution v2 (`key.id`).

export type FakeRequest = {
  path: string;
  body: Record<string, unknown>;
  at: number;
  hasApiKey: boolean;
  /** Em sendMedia: o que a Evolution simulada conseguiu baixar da URL assinada (como a real faria). */
  download?: { status: number; bytes: number; head: string };
};

export type FakeEvolution = {
  url: string;
  requests: FakeRequest[];
  /** Define o comportamento por requisição: status HTTP de falha (ou null para sucesso) e atraso em ms. */
  behavior: {
    fail?: (request: { path: string; body: Record<string, unknown> }) => number | null;
    delay?: (request: { path: string; body: Record<string, unknown> }) => number;
    /** JID REAL do WhatsApp para um número (POST /chat/whatsappNumbers). Devolva null para "número não encontrado". Padrão: o próprio número. */
    jidFor?: (digits: string) => string | null;
    /** Resposta de POST /chat/findMessages (a Evolution guarda a mensagem; depois de uma edição o texto novo está lá). */
    findMessages?: (body: Record<string, unknown>) => unknown;
    /** Resposta de POST /chat/getBase64FromMediaMessage (arquivo recebido em base64). Sem isso, devolve a resposta genérica (sem arquivo). */
    media?: (body: Record<string, unknown>) => { base64: string; mimetype: string } | null;
  };
  reset: () => void;
  close: () => Promise<void>;
};

export async function startFakeEvolution(port: number): Promise<FakeEvolution> {
  const requests: FakeRequest[] = [];
  const behavior: FakeEvolution["behavior"] = {};
  let counter = 0;

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", async () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      } catch {
        body = {};
      }
      const path = req.url ?? "";
      const entry: FakeRequest = { path, body, at: Date.now(), hasApiKey: Boolean(req.headers.apikey) };
      const info = { path, body };
      // sendMedia: a Evolution real baixa o arquivo pela URL; a simulada faz o mesmo e guarda o que recebeu.
      // sendWhatsAppAudio (mensagem de voz): o campo é "audio"; o resto é igual. editar (updateMessage), apagar para todos
      // (deleteMessageForEveryone) e reagir (sendReaction) só registram o pedido e respondem com a chave.
      const mediaUrl = path.includes("/message/sendMedia/") ? body.media : path.includes("/message/sendWhatsAppAudio/") ? body.audio : undefined;
      if (typeof mediaUrl === "string" && mediaUrl.startsWith("http")) {
        try {
          const download = await fetch(mediaUrl);
          const bytes = new Uint8Array(await download.arrayBuffer());
          entry.download = { status: download.status, bytes: bytes.length, head: Buffer.from(bytes.slice(0, 8)).toString("hex") };
        } catch {
          entry.download = { status: 0, bytes: 0, head: "" };
        }
      }
      // O pedido só aparece em `requests` depois do download (quando há), para o teste nunca ler o registro pela metade.
      requests.push(entry);
      if (path.includes("/chat/findMessages/")) {
        const answer = behavior.findMessages ? behavior.findMessages(body) : { messages: { total: 0, records: [] } };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(answer));
        return;
      }
      // Consulta do JID real do chat (a Evolution responde uma lista com { exists, jid, number }).
      if (path.includes("/chat/getBase64FromMediaMessage/") && behavior.media) {
        const file = behavior.media(body);
        if (file) {
          res.writeHead(201, { "content-type": "application/json" });
          res.end(JSON.stringify(file));
          return;
        }
      }
      if (path.includes("/chat/whatsappNumbers/")) {
        const numbers = Array.isArray(body.numbers) ? (body.numbers as string[]) : [];
        const list = numbers.map((digits) => {
          const jid = behavior.jidFor ? behavior.jidFor(digits) : `${digits}@s.whatsapp.net`;
          return jid ? { exists: true, jid, number: digits } : { exists: false, jid: `${digits}@s.whatsapp.net`, number: digits };
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(list));
        return;
      }
      const wait = behavior.delay?.(info) ?? 0;
      setTimeout(() => {
        const downloadFailed = entry.download !== undefined && entry.download.status !== 200;
        const failStatus = downloadFailed ? 502 : (behavior.fail?.(info) ?? null);
        if (failStatus) {
          res.writeHead(failStatus, { "content-type": "application/json" });
          res.end(JSON.stringify({ status: failStatus, error: "Simulated failure", response: { message: ["simulated"] } }));
          return;
        }
        counter += 1;
        res.writeHead(201, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            key: { remoteJid: `${String(body.number ?? "0")}@s.whatsapp.net`, fromMe: true, id: `FAKE-EVO-${Date.now()}-${counter}` },
            status: "PENDING",
          }),
        );
      }, wait);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    behavior,
    reset: () => {
      requests.length = 0;
      behavior.fail = undefined;
      behavior.delay = undefined;
      behavior.jidFor = undefined;
      behavior.findMessages = undefined;
      behavior.media = undefined;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
