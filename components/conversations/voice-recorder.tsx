"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Send, Trash2, Square } from "lucide-react";
import type { VoiceToSend } from "@/lib/conversations/send-client";
import { MAX_VOICE_SECONDS, formatVoiceTime, pickVoiceFormat, voiceErrorMessage } from "@/lib/conversations/voice";

type Phase = "idle" | "recording" | "review";

type VoiceRecorderProps = {
  /** Desligado em conversa que não aceita envio, ou enquanto outra coisa ocupa a caixa. */
  disabled?: boolean;
  /** Gravação pronta e confirmada pela pessoa. */
  onSend: (voice: VoiceToSend) => void;
  /** Mostra um aviso na área de avisos do compositor. */
  onNotice: (message: string) => void;
  /** Avisa o compositor que a gravação está em uso (esconde a caixa de texto). */
  onActiveChange?: (active: boolean) => void;
};

/**
 * Botão de microfone: grava, mostra o tempo, deixa cancelar e ouvir antes de enviar. O envio sai como mensagem de voz (PTT).
 * Limite de 10 minutos. Sem transcrição. A permissão do microfone negada vira uma mensagem amigável.
 */
export function VoiceRecorder({ disabled, onSend, onNotice, onActiveChange }: VoiceRecorderProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const resultRef = useRef<{ blob: Blob; fileName: string; durationSeconds: number } | null>(null);
  const cancelledRef = useRef(false);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const clearPreview = useCallback(() => {
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    resultRef.current = null;
  }, []);

  const finish = useCallback(
    (next: Phase) => {
      setPhase(next);
      onActiveChange?.(next !== "idle");
    },
    [onActiveChange],
  );

  // Ao sair da conversa: solta o microfone e a prévia.
  useEffect(
    () => () => {
      cancelledRef.current = true;
      if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    },
    [],
  );

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, []);

  const start = async () => {
    if (disabled || phase !== "idle") return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      onNotice("Este navegador não grava áudio. Use o Chrome, o Edge ou o Safari atualizados.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      onNotice(voiceErrorMessage(error));
      return;
    }
    streamRef.current = stream;
    const format = pickVoiceFormat((type) => MediaRecorder.isTypeSupported(type));
    let recorder: MediaRecorder;
    try {
      recorder = format ? new MediaRecorder(stream, { mimeType: format.mime }) : new MediaRecorder(stream);
    } catch {
      releaseStream();
      onNotice("Não foi possível iniciar a gravação neste navegador.");
      return;
    }
    recorderRef.current = recorder;
    chunksRef.current = [];
    cancelledRef.current = false;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const duration = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
      releaseStream();
      if (cancelledRef.current) {
        chunksRef.current = [];
        return;
      }
      const type = recorder.mimeType || format?.mime || "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      chunksRef.current = [];
      if (blob.size === 0) {
        finish("idle");
        onNotice("A gravação saiu vazia. Tente de novo.");
        return;
      }
      const extension = format?.extension ?? (type.includes("ogg") ? "ogg" : type.includes("mp4") ? "m4a" : "webm");
      resultRef.current = { blob, fileName: `voz.${extension}`, durationSeconds: Math.min(duration, MAX_VOICE_SECONDS) };
      setPreviewUrl(URL.createObjectURL(blob));
      finish("review");
    };

    startedAtRef.current = Date.now();
    setSeconds(0);
    recorder.start(1000);
    finish("recording");
    timerRef.current = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
      setSeconds(elapsed);
      if (elapsed >= MAX_VOICE_SECONDS) {
        onNotice("Limite de 10 minutos atingido: a gravação foi encerrada.");
        stop();
      }
    }, 250);
  };

  const cancel = () => {
    cancelledRef.current = true;
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    releaseStream();
    clearPreview();
    finish("idle");
  };

  const discard = () => {
    clearPreview();
    finish("idle");
  };

  const send = () => {
    const result = resultRef.current;
    if (!result) return;
    onSend({ blob: result.blob, fileName: result.fileName, durationSeconds: result.durationSeconds });
    clearPreview();
    finish("idle");
  };

  if (phase === "idle") {
    return (
      <button
        aria-label="Gravar áudio"
        className="flex size-11 shrink-0 items-center justify-center rounded-control border border-border text-text-muted transition-colors hover:bg-neutral-soft hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
        data-testid="voice-start"
        disabled={disabled}
        onClick={() => void start()}
        title="Gravar mensagem de voz"
        type="button"
      >
        <Mic aria-hidden="true" size={18} />
      </button>
    );
  }

  return (
    <div
      className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-control border border-border bg-background px-2"
      data-testid="voice-bar"
      data-voice-recording={phase === "recording" ? "true" : undefined}
      role="group"
      aria-label={phase === "recording" ? "Gravando áudio" : "Áudio gravado"}
    >
      <button
        aria-label="Cancelar gravação"
        className="flex size-9 shrink-0 items-center justify-center rounded-control text-danger hover:bg-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        data-testid="voice-cancel"
        onClick={phase === "recording" ? cancel : discard}
        type="button"
      >
        <Trash2 aria-hidden="true" size={18} />
      </button>

      {phase === "recording" ? (
        <>
          <span aria-hidden="true" className="size-2.5 shrink-0 animate-pulse rounded-full bg-danger" />
          <span aria-live="off" className="min-w-0 flex-1 text-body font-medium tabular-nums text-text" data-testid="voice-timer">
            {formatVoiceTime(seconds)} <span className="text-caption font-normal text-text-muted">/ {formatVoiceTime(MAX_VOICE_SECONDS)}</span>
          </span>
          <button
            aria-label="Parar gravação"
            className="flex size-9 shrink-0 items-center justify-center rounded-control bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            data-testid="voice-stop"
            onClick={stop}
            type="button"
          >
            <Square aria-hidden="true" fill="currentColor" size={14} />
          </button>
        </>
      ) : (
        <>
          {previewUrl ? (
            <audio aria-label="Ouvir a gravação antes de enviar" className="h-9 min-w-0 flex-1" controls data-testid="voice-preview" src={previewUrl} />
          ) : null}
          <button
            aria-label="Enviar áudio"
            className="flex size-9 shrink-0 items-center justify-center rounded-control bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            data-testid="voice-send"
            onClick={send}
            type="button"
          >
            <Send aria-hidden="true" size={16} />
          </button>
        </>
      )}
    </div>
  );
}
