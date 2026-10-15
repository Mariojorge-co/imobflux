"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Hourglass, MessageCircleWarning } from "lucide-react";
import { SLA_TONE_CLASS, describeSlaFor } from "@/lib/conversations/sla-display";

type SlaBadgeProps = {
  direction: string | null | undefined;
  lastActivityAt: string | null | undefined;
  /** Conversa encerrada (arquivada): nenhum contador. */
  closed?: boolean;
  /** "compact" mostra só o tempo; "full" mostra a frase completa. */
  variant?: "compact" | "full";
  className?: string;
};

/** Indicador de SLA: cor + ícone + texto (nunca só cor). Recalcula a cada minuto. */
export function SlaBadge({ direction, lastActivityAt, closed = false, variant = "compact", className = "" }: SlaBadgeProps) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const sla = closed ? null : describeSlaFor(direction, lastActivityAt);
  if (!sla) return null;

  const Icon = sla.teamWaiting ? (sla.urgent ? AlertCircle : MessageCircleWarning) : Hourglass;
  const text = variant === "full" ? sla.fullLabel : sla.shortLabel;

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-pill border px-2 py-0.5 text-caption font-medium ${SLA_TONE_CLASS[sla.tone]} ${sla.urgent ? "font-bold" : ""} ${className}`}
      data-sla-tone={sla.tone}
      data-testid="sla-badge"
      title={sla.fullLabel}
    >
      <Icon aria-hidden="true" size={12} />
      <span aria-hidden={variant === "compact" ? "true" : undefined} suppressHydrationWarning>{text}</span>
      {variant === "compact" ? <span className="sr-only" suppressHydrationWarning>{sla.fullLabel}</span> : null}
    </span>
  );
}
