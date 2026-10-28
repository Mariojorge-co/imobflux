// Som do aviso. Os navegadores só liberam áudio depois de um toque/clique/tecla da pessoa (regra de autoplay): por isso existe UM contexto
// de áudio compartilhado, "destravado" na primeira interação. Sem isso o som falha sem avisar.

export type AudioStatus = "unsupported" | "locked" | "unlocked";
export type SoundResult = "played" | "blocked" | "unsupported";

let context: AudioContext | null = null;
const listeners = new Set<() => void>();

function audioConstructor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ?? null;
}

function notify() {
  listeners.forEach((listener) => listener());
}

function sharedContext(): AudioContext | null {
  if (context && context.state !== "closed") return context;
  const Context = audioConstructor();
  if (!Context) return null;
  try {
    context = new Context();
    context.addEventListener("statechange", notify);
  } catch {
    context = null;
  }
  return context;
}

export function getAudioStatus(): AudioStatus {
  if (!audioConstructor()) return "unsupported";
  return context && context.state === "running" ? "unlocked" : "locked";
}

export function subscribeAudioStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Deve rodar dentro de um gesto da pessoa (toque, clique ou tecla). Devolve se o áudio ficou liberado. */
export async function unlockAudio(): Promise<boolean> {
  const audio = sharedContext();
  if (!audio) return false;
  try {
    if (audio.state !== "running") await audio.resume();
  } catch {
    // continua bloqueado
  }
  notify();
  return audio.state === "running";
}

/** Liga o destravamento na primeira interação (e religa se o navegador suspender o áudio ao voltar para a aba). */
export function installAudioUnlock(): () => void {
  const events = ["pointerdown", "keydown", "touchend"] as const;
  const onGesture = () => {
    void unlockAudio().then((ok) => {
      if (ok) events.forEach((name) => window.removeEventListener(name, onGesture, true));
    });
  };
  const onVisible = () => {
    if (document.visibilityState === "visible" && context && context.state === "suspended") void context.resume().catch(() => undefined);
  };
  events.forEach((name) => window.addEventListener(name, onGesture, true));
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    events.forEach((name) => window.removeEventListener(name, onGesture, true));
    document.removeEventListener("visibilitychange", onVisible);
  };
}

/** Som curto gerado na hora (sem arquivo de áudio). Devolve "blocked" quando o navegador ainda não liberou o áudio. */
export async function playNotificationSound(volume: number): Promise<SoundResult> {
  const audio = sharedContext();
  if (!audio) return "unsupported";
  try {
    if (audio.state !== "running") await audio.resume();
    if (audio.state !== "running") return "blocked";
    const gain = audio.createGain();
    gain.gain.value = Math.min(1, Math.max(0, volume)) * 0.4;
    gain.connect(audio.destination);
    const now = audio.currentTime;
    [660, 880].forEach((frequency, index) => {
      const oscillator = audio.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      oscillator.start(now + index * 0.12);
      oscillator.stop(now + index * 0.12 + 0.1);
    });
    return "played";
  } catch {
    return "blocked";
  }
}
