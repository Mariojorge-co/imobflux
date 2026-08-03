export type UrgencyLevel = "medium" | "high" | "critical";

export type LeadChannel =
  | "WhatsApp"
  | "Portal imobiliário"
  | "Indicação"
  | "Instagram"
  | "Site";

export type NextAction =
  | "Responder mensagem"
  | "Solicitar documentação"
  | "Retomar contato"
  | "Confirmar interesse"
  | "Enviar simulação"
  | "Agendar atendimento";

export type PriorityClientStatus =
  | "new"
  | "waiting"
  | "documentation"
  | "follow-up"
  | "at-risk";

export type ClientSummary = {
  channel: LeadChannel;
  context: string;
  id: string;
  name: string;
};

export type PriorityClient = ClientSummary & {
  nextAction: NextAction;
  status: PriorityClientStatus;
  urgency: UrgencyLevel;
  waitingTime: string;
};

export type CompactPriorityClient = ClientSummary & {
  nextAction: NextAction;
  timingLabel: string;
  urgency: UrgencyLevel;
};

export type PrioritySummaryId =
  | "waiting-response"
  | "today-follow-ups"
  | "stale-clients"
  | "at-risk";

export type PrioritySummaryItem = {
  context: string;
  id: PrioritySummaryId;
  title: string;
  value: number;
};
