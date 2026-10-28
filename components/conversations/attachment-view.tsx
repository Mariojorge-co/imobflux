"use client";

import { useState, useTransition } from "react";
import { Eye, EyeOff, ExternalLink, FileText, Paperclip, Play, RotateCw } from "lucide-react";
import { retryAttachmentDownloadAction } from "@/lib/conversations/actions";
import { describeAttachment } from "@/lib/conversations/attachment-label";
import { isDownloadInProgress, viewerKindForMime } from "@/lib/conversations/media-types";
import { isStickerAttachment, STICKER_MAX_PX } from "@/lib/conversations/sticker";
import { MediaLightbox } from "@/components/conversations/media-lightbox";
import { formatFileSize } from "@/lib/conversations/outgoing-files";
import type { ConversationMessageAttachment } from "@/lib/conversations/data";

type AttachmentViewProps = {
  attachment: ConversationMessageAttachment;
  isOutgoing: boolean;
  /** Texto da mensagem (a figurinha também é reconhecida pelo rótulo "Figurinha"). */
  messageText?: string | null;
};

const RETRY_TIMEOUT_MS = 70_000;
const linkClass = "inline-flex min-h-9 items-center gap-1 rounded-control px-2 text-xs font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

/**
 * Exibe um anexo de mensagem dentro da conversa: figurinha pequena, foto e vídeo com altura limitada (clique amplia),
 * player de áudio e PDF com pré-visualização. Se o arquivo ainda não está disponível (ou falhou), degrada para um aviso
 * com a opção de tentar novamente, sem afetar o restante da conversa.
 */
export function AttachmentView({ attachment, isOutgoing, messageText }: AttachmentViewProps) {
  // "Tentar de novo" numa mídia que não carregou: outra tentativa com um parâmetro novo (a rota ignora; evita reaproveitar a falha).
  const [attempt, setAttempt] = useState(0);
  const src = `/api/attachments/${attachment.id}${attempt > 0 ? `?r=${attempt}` : ""}`;
  const description = describeAttachment(attachment);
  const [broken, setBroken] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [retry, setRetry] = useState<{ state: "idle" | "running" | "done" | "error"; message?: string }>({ state: "idle" });
  const [, startTransition] = useTransition();

  // A imagem pode terminar de carregar (ou falhar) antes de o React hidratar a página: o onLoad/onError não dispara mais e a
  // miniatura ficava para sempre no quadrado vazio. Ao anexar o elemento, confere o estado real dele.
  const settleImage = (element: HTMLImageElement | null) => {
    if (!element || !element.complete) return;
    if (element.naturalWidth > 0) setLoaded(true);
    else setBroken(true);
  };
  const reload = () => {
    setBroken(false);
    setLoaded(false);
    setAttempt((current) => current + 1);
  };

  const tone = isOutgoing ? "bg-white/10 text-primary-foreground/80" : "bg-neutral-soft text-text-muted";
  const cardClass = `mb-1.5 flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-xs ${tone}`;
  const kind = viewerKindForMime(attachment.mime_type);

  // Arquivo que ainda está sendo enviado (bolha provisória): miniatura local da imagem, ou cartão com nome e tamanho.
  // Não existe no servidor ainda, então nunca chama a rota de anexos.
  if (attachment.id.startsWith("local-")) {
    if (kind === "image" && attachment.local_preview_url) {
      return (
        // eslint-disable-next-line @next/next/no-img-element -- miniatura local (blob:) do arquivo escolhido
        <img
          alt={attachment.file_name}
          className="mb-1.5 block h-auto max-h-[180px] w-auto max-w-[180px] rounded-lg object-contain sm:max-h-[220px] sm:max-w-[220px]"
          data-testid="local-image-preview"
          src={attachment.local_preview_url}
        />
      );
    }
    return (
      <div className={cardClass} data-testid="local-file-card">
        <FileText aria-hidden="true" className="mt-0.5 shrink-0" size={14} strokeWidth={1.8} />
        <span className="min-w-0">
          <span className="block break-words font-medium">{attachment.file_name}</span>
          <span className="block">{formatFileSize(attachment.size_bytes)}</span>
        </span>
      </div>
    );
  }

  if (attachment.status === "available" && !broken) {
    // Figurinha: pequena, sem moldura, sem ampliar.
    if (kind === "image" && isStickerAttachment(attachment, messageText)) {
      return (
        // eslint-disable-next-line @next/next/no-img-element -- arquivo privado servido pela rota autenticada
        <img
          alt="Figurinha"
          className="block object-contain"
          data-testid="sticker-image"
          loading="lazy"
          onError={() => setBroken(true)}
          ref={settleImage}
          src={src}
          style={{ height: "auto", maxHeight: STICKER_MAX_PX, maxWidth: STICKER_MAX_PX, width: "auto" }}
        />
      );
    }

    // Foto e vídeo: o MAIOR lado limitado (celular 180 px, desktop 220 px), proporção preservada, espaço reservado até carregar
    // (a rolagem não "pula") e o clique abre ampliada.
    if (kind === "image") {
      return (
        <>
          <button
            aria-label={`Ampliar imagem ${attachment.file_name}`}
            className={`mb-1.5 block max-w-full cursor-zoom-in overflow-hidden rounded-lg ${loaded ? "" : "h-40 w-40 animate-pulse bg-neutral-soft"}`}
            data-testid="image-thumb"
            onClick={() => setLightboxOpen(true)}
            type="button"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- arquivo privado servido pela rota autenticada */}
            <img
              alt={attachment.file_name}
              className={`block h-auto max-h-[180px] w-auto max-w-[180px] object-contain sm:max-h-[220px] sm:max-w-[220px] ${loaded ? "" : "opacity-0"}`}
              key={attempt}
              loading="lazy"
              onError={() => setBroken(true)}
              onLoad={() => setLoaded(true)}
              ref={settleImage}
              src={src}
            />
          </button>
          <MediaLightbox kind="image" label={attachment.file_name} onClose={() => setLightboxOpen(false)} open={lightboxOpen} src={src} />
        </>
      );
    }

    if (kind === "audio") {
      return (
        <div className="mb-1.5 max-w-full">
          <audio aria-label={description.title} className="w-full min-w-48" controls onError={() => setBroken(true)} preload="metadata" src={src} />
          <a className={`${linkClass} ${isOutgoing ? "text-primary-foreground/80" : "text-text-muted"}`} href={src} rel="noreferrer" target="_blank">
            <ExternalLink aria-hidden="true" size={12} /> Abrir áudio
          </a>
        </div>
      );
    }

    if (kind === "video") {
      return (
        <>
          {/* Vídeo: mesmo limite da foto (maior lado 180 px no celular, 220 px no desktop); o clique abre ampliado e toca. */}
          <button
            aria-label={`Ampliar vídeo ${attachment.file_name}`}
            className="relative mb-1.5 block max-w-full cursor-zoom-in overflow-hidden rounded-lg"
            data-testid="video-thumb"
            onClick={() => setLightboxOpen(true)}
            type="button"
          >
            <video
              aria-hidden="true"
              className="block h-auto max-h-[180px] w-auto max-w-[180px] object-contain sm:max-h-[220px] sm:max-w-[220px]"
              key={attempt}
              muted
              onError={() => setBroken(true)}
              playsInline
              preload="metadata"
              src={`${src}#t=0.001`}
              tabIndex={-1}
            />
            <span className="absolute inset-0 flex items-center justify-center bg-black/20">
              <span className="flex size-9 items-center justify-center rounded-full bg-black/60 text-white">
                <Play aria-hidden="true" fill="currentColor" size={16} />
              </span>
            </span>
          </button>
          <MediaLightbox kind="video" label={attachment.file_name} onClose={() => setLightboxOpen(false)} open={lightboxOpen} src={src} />
        </>
      );
    }

    // PDF e demais arquivos: cartão com ações. O PDF pode ser pré-visualizado aqui; em celulares
    // que não exibem PDF embutido, "Abrir em nova aba" usa o visualizador do próprio navegador.
    return (
      <div className={`mb-1.5 rounded-lg px-2.5 py-1.5 text-xs ${tone}`}>
        <div className="flex items-start gap-1.5">
          <FileText aria-hidden="true" className="mt-0.5 shrink-0" size={14} strokeWidth={1.8} />
          <span className="min-w-0 break-words font-medium">{description.title}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-1">
          {kind === "pdf" ? (
            <button aria-expanded={previewOpen} className={linkClass} onClick={() => setPreviewOpen((open) => !open)} type="button">
              {previewOpen ? <EyeOff aria-hidden="true" size={12} /> : <Eye aria-hidden="true" size={12} />}
              {previewOpen ? "Ocultar visualização" : "Visualizar aqui"}
            </button>
          ) : null}
          <a className={linkClass} href={src} rel="noreferrer" target="_blank">
            <ExternalLink aria-hidden="true" size={12} /> {kind === "pdf" ? "Abrir em nova aba" : "Abrir / salvar"}
          </a>
        </div>
        {kind === "pdf" && previewOpen ? (
          <iframe
            className="mt-1.5 h-[60vh] max-h-[480px] w-full rounded-md border border-border bg-white"
            loading="lazy"
            src={src}
            title={`Visualização de ${attachment.file_name}`}
          />
        ) : null}
      </div>
    );
  }

  if (isDownloadInProgress(attachment) && !broken) {
    return (
      <div aria-live="polite" className={cardClass} role="status">
        <Paperclip aria-hidden="true" className="mt-0.5 shrink-0" size={12} strokeWidth={1.8} />
        <span className="min-w-0">
          <span className="block break-words font-medium">{description.title}</span>
          <span className="block">Carregando arquivo…</span>
        </span>
      </div>
    );
  }

  return (
    <div className={cardClass} data-testid="attachment-unavailable">
      <Paperclip aria-hidden="true" className="mt-0.5 shrink-0" size={12} strokeWidth={1.8} />
      <span className="min-w-0">
        <span className="block break-words font-medium">{description.title}</span>
        <span className="block">
          {broken ? "Não foi possível exibir o arquivo aqui — abra no WhatsApp para vê-lo." : description.hint}
        </span>
        {retry.state === "error" ? <span className="block text-danger" role="alert">{retry.message}</span> : null}
        {retry.state === "done" ? <span aria-live="polite" className="block" role="status">Arquivo carregado, atualizando…</span> : null}
        {!broken ? (
          <button
            className={`${linkClass} disabled:opacity-60`}
            disabled={retry.state === "running" || retry.state === "done"}
            onClick={() => {
              setRetry({ state: "running" });
              startTransition(async () => {
                // Nunca fica "Tentando…" para sempre: passados 70 s sem resposta o estado vira erro e o botão volta.
                const timeout = new Promise<{ success: false; error: string }>((resolve) =>
                  setTimeout(() => resolve({ success: false, error: "Demorou demais. Tente de novo ou abra no WhatsApp." }), RETRY_TIMEOUT_MS),
                );
                const result = await Promise.race([retryAttachmentDownloadAction(attachment.id), timeout]).catch(() => ({
                  success: false as const,
                  error: "Não foi possível carregar o arquivo agora. Tente de novo ou abra no WhatsApp.",
                }));
                setRetry(result.success ? { state: "done" } : { state: "error", message: result.error });
              });
            }}
            type="button"
          >
            <RotateCw aria-hidden="true" size={12} /> {retry.state === "running" ? "Tentando…" : "Tentar de novo"}
          </button>
        ) : (
          <>
            {kind === "image" || kind === "video" ? (
              <button className={linkClass} data-testid="attachment-reload" onClick={reload} type="button">
                <RotateCw aria-hidden="true" size={12} /> Tentar de novo
              </button>
            ) : null}
            <a className={linkClass} href={src} rel="noreferrer" target="_blank">
              <ExternalLink aria-hidden="true" size={12} /> Tentar abrir diretamente
            </a>
          </>
        )}
      </span>
    </div>
  );
}
