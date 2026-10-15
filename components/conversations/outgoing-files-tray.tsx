"use client";

import { FileText, Film, Music, X } from "lucide-react";
import type { OutgoingFiles, OutgoingItem } from "@/components/conversations/use-outgoing-files";
import { formatFileSize } from "@/lib/conversations/outgoing-files";

function Thumb({ item }: { item: OutgoingItem }) {
  if (item.previewUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- miniatura local (blob:) do arquivo escolhido
      <img alt="" className="size-14 shrink-0 rounded-md object-cover" src={item.previewUrl} />
    );
  }
  const Icon = item.kind === "video" ? Film : item.kind === "audio" ? Music : FileText;
  return (
    <span className="flex size-14 shrink-0 items-center justify-center rounded-md bg-neutral-soft text-text-muted">
      <Icon aria-hidden="true" size={22} />
    </span>
  );
}

/**
 * Bandeja de arquivos escolhidos, acima da caixa de mensagem: miniatura/ícone, nome, tamanho, barra de progresso do
 * upload, cancelar/remover, legenda opcional e (imagem) "enviar como documento".
 */
export function OutgoingFilesTray({ files }: { files: OutgoingFiles }) {
  if (files.items.length === 0 && !files.notice) return null;

  return (
    <div className="mb-1.5 space-y-1.5" data-testid="outgoing-tray">
      {files.notice ? (
        <div className="flex items-start justify-between gap-2 rounded-control bg-danger-soft px-3 py-1.5 text-caption font-medium text-danger" data-testid="outgoing-notice" role="alert">
          <span className="break-words">{files.notice}</span>
          <button aria-label="Fechar aviso" className="shrink-0 rounded-control px-1 hover:bg-surface/70" onClick={files.clearNotice} type="button">
            ✕
          </button>
        </div>
      ) : null}

      {files.items.length > 0 ? (
        <ul aria-label="Arquivos para enviar" className="flex max-h-[min(14rem,35dvh)] flex-col gap-1.5 overflow-y-auto">
          {files.items.map((item) => (
            <li className="flex items-start gap-2 rounded-control border border-border bg-background p-1.5" data-testid="outgoing-item" key={item.id}>
              <Thumb item={item} />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-body font-medium text-text" title={item.name}>{item.name}</p>
                    <p className="text-caption text-text-muted">
                      {formatFileSize(item.size)}
                      {item.status === "uploading" ? ` · enviando ${Math.round(item.progress * 100)}%` : item.status === "ready" ? " · pronto" : ""}
                    </p>
                  </div>
                  <button
                    aria-label={item.status === "uploading" ? `Cancelar o envio de ${item.name}` : `Remover ${item.name}`}
                    className="flex size-9 shrink-0 items-center justify-center rounded-control text-text-muted hover:bg-neutral-soft hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    data-testid="outgoing-remove"
                    onClick={() => files.remove(item.id)}
                    type="button"
                  >
                    <X aria-hidden="true" size={16} />
                  </button>
                </div>

                {item.status === "uploading" ? (
                  <div
                    aria-label={`Progresso do envio de ${item.name}`}
                    aria-valuemax={100}
                    aria-valuemin={0}
                    aria-valuenow={Math.round(item.progress * 100)}
                    className="h-1.5 overflow-hidden rounded-full bg-neutral-soft"
                    role="progressbar"
                  >
                    <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(item.progress * 100)}%` }} />
                  </div>
                ) : null}

                {item.status === "error" ? (
                  <p className="text-caption font-medium text-danger" role="alert">{item.error}</p>
                ) : null}

                {item.status !== "error" && item.kind !== "audio" ? (
                  <input
                    aria-label={`Legenda de ${item.name}`}
                    className="min-h-9 w-full rounded-control border border-border bg-surface px-2 text-caption text-text placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    maxLength={1024}
                    onChange={(event) => files.setCaption(item.id, event.target.value)}
                    placeholder="Legenda (opcional)"
                    value={item.caption}
                  />
                ) : null}

                {item.status !== "error" && item.kind === "image" ? (
                  <label className="flex min-h-9 items-center gap-2 text-caption text-text">
                    <input
                      checked={item.asDocument}
                      className="size-4 accent-primary"
                      onChange={(event) => files.setAsDocument(item.id, event.target.checked)}
                      type="checkbox"
                    />
                    Enviar como documento (sem compressão)
                  </label>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
