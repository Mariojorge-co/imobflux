"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { AlertCircle, Hourglass, MessageCircleWarning } from "lucide-react";
import { useSlaSettings } from "@/components/conversations/sla-settings-context";
import { SLA_TONE_CLASS, describeSlaFor } from "@/lib/conversations/sla-display";

type SlaBadgeProps = {
  direction: string | null | undefined;
  lastActivityAt: string | null | undefined;
  /** Conversa encerrada (arquivada): nenhum contador. */
  closed?: boolean;
  /** "compact" mostra só o tempo; "full" mostra a frase completa; "responsive" é compacto no celular (até 767px) e completo no resto. */
  variant?: "compact" | "full" | "responsive";
  className?: string;
};

const MOBILE_QUERY = "(max-width: 767px)";
function subscribeMobile(onChange: () => void) {
  const media = window.matchMedia(MOBILE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** Indicador de SLA: cor + ícone + texto (nunca só cor). Recalcula a cada minuto. */
export function SlaBadge({ direction, lastActivityAt, closed = false, variant: requested = "compact", className = "" }: SlaBadgeProps) {
  const isMobile = useSyncExternalStore(subscribeMobile, () => window.matchMedia(MOBILE_QUERY).matches, () => false);
  const variant = requested === "responsive" ? (isMobile ? "compact" : "full") : requested;
  const [, setTick] = useState(0);
  const settings = useSlaSettings();

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const sla = closed ? null : describeSlaFor(direction, lastActivityAt, settings);
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
