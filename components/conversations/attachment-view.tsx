"use client";

import { useState, useTransition } from "react";
import { Eye, EyeOff, ExternalLink, FileText, Paperclip, RotateCw } from "lucide-react";
import { retryAttachmentDownloadAction } from "@/lib/conversations/actions";
import { describeAttachment } from "@/lib/conversations/attachment-label";
import { isDownloadInProgress, viewerKindForMime } from "@/lib/conversations/media-types";
import type { ConversationMessageAttachment } from "@/lib/conversations/data";

type AttachmentViewProps = {
  attachment: ConversationMessageAttachment;
  isOutgoing: boolean;
};

const linkClass = "inline-flex min-h-9 items-center gap-1 rounded-control px-2 text-xs font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

/**
 * Exibe um anexo de mensagem dentro da conversa: imagem, player de áudio/vídeo e PDF com
 * pré-visualização. Se o arquivo ainda não está disponível (ou falhou), degrada para um aviso
 * com a opção de tentar novamente, sem afetar o restante da conversa.
 */
export function AttachmentView({ attachment, isOutgoing }: AttachmentViewProps) {
  const src = `/api/attachments/${attachment.id}`;
  const description = describeAttachment(attachment);
  const [broken, setBroken] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [retry, setRetry] = useState<{ state: "idle" | "running" | "done" | "error"; message?: string }>({ state: "idle" });
  const [, startTransition] = useTransition();

  const tone = isOutgoing ? "bg-white/10 text-primary-foreground/80" : "bg-neutral-soft text-text-muted";
  const cardClass = `mb-1.5 flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-xs ${tone}`;
  const kind = viewerKindForMime(attachment.mime_type);

  if (attachment.status === "available" && !broken) {
    if (kind === "image") {
      return (
        <a className="mb-1.5 block" href={src} rel="noreferrer" target="_blank">
          {/* eslint-disable-next-line @next/next/no-img-element -- arquivo privado servido pela rota autenticada */}
          <img
            alt={attachment.file_name}
            className="max-h-72 max-w-full rounded-lg object-contain"
            loading="lazy"
            onError={() => setBroken(true)}
            src={src}
          />
        </a>
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
        <div className="mb-1.5 max-w-full">
          <video aria-label={description.title} className="max-h-72 max-w-full rounded-lg" controls onError={() => setBroken(true)} playsInline preload="metadata" src={src} />
        </div>
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
            className="mt-1.5 h-[70vh] w-full rounded-md border border-border bg-white"
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
    <div className={cardClass}>
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
                const result = await retryAttachmentDownloadAction(attachment.id);
                setRetry(result.success ? { state: "done" } : { state: "error", message: result.error });
              });
            }}
            type="button"
          >
            <RotateCw aria-hidden="true" size={12} /> {retry.state === "running" ? "Tentando…" : "Tentar novamente"}
          </button>
        ) : (
          <a className={linkClass} href={src} rel="noreferrer" target="_blank">
            <ExternalLink aria-hidden="true" size={12} /> Tentar abrir diretamente
          </a>
        )}
      </span>
    </div>
  );
}
