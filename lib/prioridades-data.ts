import type {
  CompactPriorityClient,
  PriorityClient,
  PrioritySummaryItem,
} from "@/types/prioridades";

export const prioritySummary = [
  {
    id: "waiting-response",
    title: "Aguardando resposta",
    value: 5,
    context: "Mais antigo aguardando: 3 dias",
  },
  {
    id: "today-follow-ups",
    title: "Follow-ups para hoje",
    value: 3,
    context: "Próximo contato às 10h30",
  },
  {
    id: "stale-clients",
    title: "Clientes sem contato recente",
    value: 3,
    context: "Maior intervalo sem contato: 12 dias",
  },
  {
    id: "at-risk",
    title: "Oportunidades em risco",
    value: 2,
    context: "2 casos exigem atenção imediata",
  },
] satisfies PrioritySummaryItem[];

export const priorityClients = [
  {
    id: "marina-alves",
    name: "Marina Alves",
    context:
      "Solicitou uma simulação para um apartamento na Vila Mariana e aguarda o envio.",
    channel: "Portal imobiliário",
    status: "at-risk",
    waitingTime: "3 dias",
    urgency: "critical",
    nextAction: "Enviar simulação",
  },
  {
    id: "rafael-duarte",
    name: "Rafael Duarte",
    context:
      "Pediu opções de dois dormitórios próximas ao metrô e ainda não recebeu retorno.",
    channel: "WhatsApp",
    status: "waiting",
    waitingTime: "1 dia",
    urgency: "critical",
    nextAction: "Responder mensagem",
  },
  {
    id: "helena-vidal",
    name: "Helena Vidal",
    context:
      "Visitou um imóvel ontem e ficou de confirmar se deseja avançar na negociação.",
    channel: "Site",
    status: "follow-up",
    waitingTime: "6 h",
    urgency: "high",
    nextAction: "Retomar contato",
  },
  {
    id: "camila-prado",
    name: "Camila Prado",
    context:
      "Demonstrou interesse na proposta e precisa concluir o envio dos documentos.",
    channel: "Indicação",
    status: "documentation",
    waitingTime: "2 h",
    urgency: "high",
    nextAction: "Solicitar documentação",
  },
  {
    id: "bruno-lacerda",
    name: "Bruno Lacerda",
    context:
      "Entrou em contato sobre um imóvel recém-publicado e aguarda a primeira resposta.",
    channel: "Instagram",
    status: "new",
    waitingTime: "18 min",
    urgency: "medium",
    nextAction: "Confirmar interesse",
  },
] satisfies PriorityClient[];

export const todayFollowUps = [
  {
    id: "sofia-nogueira",
    name: "Sofia Nogueira",
    context: "Retomar o interesse em um imóvel próximo ao trabalho.",
    channel: "WhatsApp",
    nextAction: "Retomar contato",
    timingLabel: "Hoje, 10h30",
    urgency: "medium",
  },
  {
    id: "vinicius-leme",
    name: "Vinícius Leme",
    context: "Enviar a simulação solicitada após a visita.",
    channel: "Portal imobiliário",
    nextAction: "Enviar simulação",
    timingLabel: "Hoje, 14h",
    urgency: "medium",
  },
  {
    id: "larissa-monte",
    name: "Larissa Monte",
    context: "Combinar o melhor horário para uma conversa.",
    channel: "Indicação",
    nextAction: "Agendar atendimento",
    timingLabel: "Hoje, 16h30",
    urgency: "medium",
  },
] satisfies CompactPriorityClient[];

export const staleClients = [
  {
    id: "gustavo-teles",
    name: "Gustavo Teles",
    context: "Recebeu opções de imóveis, mas não respondeu ao último contato.",
    channel: "WhatsApp",
    nextAction: "Retomar contato",
    timingLabel: "Sem contato há 5 dias",
    urgency: "high",
  },
  {
    id: "paola-viana",
    name: "Paola Viana",
    context: "Visitou dois imóveis e ainda não confirmou se deseja continuar.",
    channel: "Site",
    nextAction: "Confirmar interesse",
    timingLabel: "Sem contato há 8 dias",
    urgency: "critical",
  },
  {
    id: "tiago-salles",
    name: "Tiago Salles",
    context: "A documentação inicial permanece incompleta.",
    channel: "Portal imobiliário",
    nextAction: "Solicitar documentação",
    timingLabel: "Sem contato há 12 dias",
    urgency: "critical",
  },
] satisfies CompactPriorityClient[];
