"use client";

// Upload DIRETO do navegador para o Storage privado do Supabase, por uma URL assinada que o servidor gerou depois de
// conferir o acesso à conversa (o arquivo não passa pela função da Vercel, que tem limite de corpo de ~4,5 MB).
// Usa XMLHttpRequest para ter progresso e poder cancelar.

export type UploadHandle = { promise: Promise<void>; abort: () => void };

export class UploadError extends Error {
  constructor(
    public readonly code: "ABORTED" | "TOO_LARGE" | "NETWORK" | "REJECTED",
    message: string,
  ) {
    super(message);
  }
}

export function uploadToSignedUrl(signedUrl: string, file: Blob, onProgress: (fraction: number) => void): UploadHandle {
  const request = new XMLHttpRequest();
  const promise = new Promise<void>((resolve, reject) => {
    request.open("PUT", signedUrl);
    const clientKey = process.env.NEXT_PUBLIC_SUPABASE_CLIENT_KEY;
    if (clientKey) request.setRequestHeader("apikey", clientKey);
    request.setRequestHeader("x-upsert", "false");

    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.min(1, event.loaded / event.total));
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(1);
        resolve();
      } else if (request.status === 413) {
        reject(new UploadError("TOO_LARGE", "O arquivo passa do limite de 25 MB."));
      } else {
        reject(new UploadError("REJECTED", "O servidor recusou o envio do arquivo. Tente de novo."));
      }
    };
    request.onerror = () => reject(new UploadError("NETWORK", "Falha de conexão ao enviar o arquivo. Verifique a internet e tente de novo."));
    request.onabort = () => reject(new UploadError("ABORTED", "Envio cancelado."));

    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("", file);
    request.send(body);
  });
  return { promise, abort: () => request.abort() };
}
