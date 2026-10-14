"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

type MediaLightboxProps = {
  open: boolean;
  onClose: () => void;
  kind: "image" | "video";
  src: string;
  label: string;
};

/**
 * Foto ou vídeo ampliado. Fecha com Esc, clicando fora da mídia e no botão de fechar. O arquivo só é carregado
 * (e o vídeo só toca) enquanto está aberto.
 */
export function MediaLightbox({ open, onClose, kind, src, label }: MediaLightboxProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      aria-label={label}
      className="m-auto max-h-[96vh] max-w-[96vw] overflow-visible border-0 bg-transparent p-0 backdrop:bg-black/80"
      data-testid="media-lightbox"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      ref={dialogRef}
    >
      {open ? (
        <div className="relative flex items-center justify-center">
          {kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element -- arquivo privado servido pela rota autenticada
            <img alt={label} className="max-h-[90vh] max-w-[94vw] rounded-lg object-contain" src={src} />
          ) : (
            <video aria-label={label} autoPlay className="max-h-[90vh] max-w-[94vw] rounded-lg" controls playsInline src={src} />
          )}
          <button
            aria-label="Fechar"
            className="absolute -top-3 -right-3 flex size-9 items-center justify-center rounded-full bg-surface text-text shadow-lg hover:bg-neutral-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>
      ) : null}
    </dialog>
  );
}
