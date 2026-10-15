"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_SLA_SETTINGS, type SlaSettings } from "@/lib/conversations/sla";

const SlaSettingsContext = createContext<SlaSettings>(DEFAULT_SLA_SETTINGS);

/** Limites de prazo do workspace para todas as telas (lista, cabeçalho, Kanban). */
export function SlaSettingsProvider({ settings, children }: { settings: SlaSettings; children: ReactNode }) {
  return <SlaSettingsContext.Provider value={settings}>{children}</SlaSettingsContext.Provider>;
}

export function useSlaSettings(): SlaSettings {
  return useContext(SlaSettingsContext);
}
