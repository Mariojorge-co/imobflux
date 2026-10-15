// Gravação de voz no navegador: formato, tempo e mensagens de erro. Funções puras (testadas sem navegador).

/** Limite de uma gravação, em segundos (10 minutos). */
export const MAX_VOICE_SECONDS = 600;

export type VoiceFormat = { mime: string; extension: "webm" | "ogg" | "m4a" };

/** Formatos que o MediaRecorder pode gravar, do melhor para o pior para o WhatsApp (a Evolution converte para ogg/opus). */
const CANDIDATES: ReadonlyArray<VoiceFormat> = [
  { mime: "audio/webm;codecs=opus", extension: "webm" },
  { mime: "audio/ogg;codecs=opus", extension: "ogg" },
  { mime: "audio/mp4", extension: "m4a" },
  { mime: "audio/webm", extension: "webm" },
];

/** Primeiro formato que o navegador sabe gravar; nulo deixa o navegador escolher. */
export function pickVoiceFormat(isSupported: (mime: string) => boolean): VoiceFormat | null {
  return CANDIDATES.find((candidate) => isSupported(candidate.mime)) ?? null;
}

/** "0:07", "10:00". */
export function formatVoiceTime(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

/** Frase amigável para o erro do navegador ao pedir o microfone. */
export function voiceErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error === "object" && error && "name" in error ? String((error as { name: unknown }).name) : "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
    return "Não consegui usar o microfone: a permissão foi negada. Libere o microfone para este site no navegador (ícone de cadeado ao lado do endereço) e tente de novo.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "Nenhum microfone foi encontrado neste aparelho.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "O microfone está em uso por outro programa. Feche-o e tente de novo.";
  }
  return "Não foi possível acessar o microfone. Tente de novo.";
}
