"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  DollarSign,
  Lock,
  MapPin,
  Plus,
  UserCheck,
  UserRound,
} from "lucide-react";
import { Badge, Button, Input } from "@/components/ui";
import {
  completeWorkTaskAction,
  updateConversationContactNameAction,
  updateQualificationAction,
  upsertWorkTaskAction,
} from "@/lib/conversations/actions";
import type { ConversationContextData } from "@/lib/conversations/data";
import { formatRelativeTime } from "@/lib/date";

import { formatCurrency, formatEnumLabel } from "@/lib/formatters";

type ClientContextPanelProps = {
  conversationId: string;
  context: ConversationContextData;
  stages?: Array<{ id: string; name: string }>;
  opportunities?: ConversationContextData[];
  selectedOpportunityId?: string | null;
  onOpportunityChange?: (opportunityId: string) => void;
  onContactUpdated?: (displayName: string, registrationStatus: string) => void;
};

const STAGES_FALLBACK = [
  { id: "41000000-0000-4000-8000-000000000001", name: "Em atendimento" },
  { id: "41000000-0000-4000-8000-000000000002", name: "Simulação / Análise" },
  { id: "41000000-0000-4000-8000-000000000003", name: "Documentação" },
  { id: "41000000-0000-4000-8000-000000000004", name: "Aprovado / Escolhendo imóvel" },
  { id: "41000000-0000-4000-8000-000000000005", name: "Negociação" },
  { id: "41000000-0000-4000-8000-000000000006", name: "Contrato" },
];

export function ClientContextPanel({
  conversationId,
  context,
  stages = STAGES_FALLBACK,
  opportunities = [],
  selectedOpportunityId,
  onOpportunityChange,
  onContactUpdated,
}: ClientContextPanelProps) {
  const [, startTransition] = useTransition();
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [showNewTaskForm, setShowNewTaskForm] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDueDate, setNewTaskDueDate] = useState("");
  const [newTaskType, setNewTaskType] = useState<"task" | "follow_up">("task");
  const [isEditingName, setIsEditingName] = useState(false);
  const [contactDisplayName, setContactDisplayName] = useState(context.contact?.display_name ?? "");
  const [contactRegistrationStatus, setContactRegistrationStatus] = useState(
    context.contact?.registration_status ?? "confirmed",
  );
  const [nameDraft, setNameDraft] = useState(context.contact?.display_name ?? "");
  const [nameError, setNameError] = useState<string | null>(null);

  const contact = context.contact;
  const activeOpp = context.active_opportunity;
  const isOwner = context.caller_role === "owner";

  // Form states
  const [operationType, setOperationType] = useState(activeOpp?.operation_type || "");
  const [propertyType, setPropertyType] = useState(activeOpp?.property_type_preference || "");
  const [cityRegion, setCityRegion] = useState(activeOpp?.city_region_preference || "");
  const [maxBudget, setMaxBudget] = useState(activeOpp?.max_price_budget?.toString() || "");
  const [downPayment, setDownPayment] = useState(activeOpp?.available_down_payment?.toString() || "");
  const [timeframe, setTimeframe] = useState(activeOpp?.timeframe_intent || "");
  const [contactNotes, setContactNotes] = useState(contact?.notes || "");

  // Financial form states (owner only)
  const [familyIncome, setFamilyIncome] = useState(context.financial_info?.family_income?.toString() || "");
  const [analysisStatus, setAnalysisStatus] = useState(context.financial_info?.financial_analysis_status || "");
  const [approvedCredit, setApprovedCredit] = useState(context.financial_info?.approved_credit_amount?.toString() || "");
  const [docsStatus, setDocsStatus] = useState(context.financial_info?.docs_status || "");

  const currentStageName =
    stages.find((s) => s.id === activeOpp?.current_stage_id)?.name
    || activeOpp?.stage_name
    || "Em atendimento";

  const handleSaveQualifications = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contact) return;

    startTransition(async () => {
      const result = await updateQualificationAction({
        contactId: contact.id,
        opportunityId: activeOpp?.opportunity_id,
        conversationId,
        operationType: operationType || undefined,
        propertyTypePreference: propertyType || undefined,
        cityRegionPreference: cityRegion || undefined,
        maxPriceBudget: maxBudget ? parseFloat(maxBudget) : undefined,
        availableDownPayment: downPayment ? parseFloat(downPayment) : undefined,
        timeframeIntent: timeframe || undefined,
        familyIncome: isOwner && familyIncome ? parseFloat(familyIncome) : undefined,
        financialAnalysisStatus: isOwner ? analysisStatus || undefined : undefined,
        approvedCreditAmount: isOwner && approvedCredit ? parseFloat(approvedCredit) : undefined,
        docsStatus: isOwner ? docsStatus || undefined : undefined,
        notes: contactNotes || undefined,
      });
      if (result.success) {
        setIsEditing(false);
        router.refresh();
      }
    });
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;

    startTransition(async () => {
      const result = await upsertWorkTaskAction({
        conversationId,
        contactId: contact?.id,
        opportunityId: activeOpp?.opportunity_id,
        taskType: newTaskType,
        title: newTaskTitle.trim(),
        dueAt: newTaskDueDate || undefined,
      });
      if (result.success) {
        setNewTaskTitle("");
        setNewTaskDueDate("");
        setShowNewTaskForm(false);
        router.refresh();
      }
    });
  };

  const handleCompleteTask = (taskId: string) => {
    startTransition(async () => {
      const result = await completeWorkTaskAction(taskId, conversationId);
      if (result.success) router.refresh();
    });
  };

  const isProvisional = contactRegistrationStatus === "provisional";

  const handleSaveContactName = (event: React.FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const result = await updateConversationContactNameAction(conversationId, nameDraft);
      if (!result.success || !result.displayName) {
        setNameError(result.error ?? "Não foi possível salvar o nome.");
        return;
      }
      const registrationStatus = result.registrationStatus ?? contactRegistrationStatus;
      setContactDisplayName(result.displayName);
      setNameDraft(result.displayName);
      setContactRegistrationStatus(registrationStatus);
      setNameError(null);
      setIsEditingName(false);
      onContactUpdated?.(result.displayName, registrationStatus);
      router.refresh();
    });
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto border-l border-border bg-surface p-4 text-text space-y-6">
      {/* 1. IDENTIFICAÇÃO DO CONTATO */}
      <section className="space-y-2 border-b border-border pb-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Identificação
          </h2>
          <div className="flex items-center gap-1.5">
            {isProvisional && (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                Contato não salvo
              </span>
            )}
            <Badge tone="info">{formatEnumLabel(contact?.classification || "person")}</Badge>
            {contact ? (
              <button
                className="text-[11px] font-medium text-primary hover:underline"
                onClick={() => { setIsEditingName(true); setNameError(null); }}
                type="button"
              >
                Editar
              </button>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <UserRound size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-semibold text-text text-sm">
              {contactDisplayName || "Contato sem nome"}
            </h3>
            <p className="truncate text-xs text-text-muted">
              {contact?.phone || "Sem telefone"}
            </p>
          </div>
        </div>

        {isEditingName ? (
          <form className="space-y-2 rounded-control border border-border bg-background p-2.5" onSubmit={handleSaveContactName}>
            <label className="block text-[11px] font-medium text-text-muted" htmlFor="conversation-contact-name">Nome no CRM</label>
            <Input
              autoFocus
              id="conversation-contact-name"
              maxLength={120}
              minLength={2}
              onChange={(event) => setNameDraft(event.target.value)}
              required
              value={nameDraft}
            />
            <p className="text-[10px] text-text-muted">O nome recebido do WhatsApp permanece separado.</p>
            {nameError ? <p className="text-[11px] text-danger">{nameError}</p> : null}
            <div className="flex justify-end gap-2">
              <Button onClick={() => { setIsEditingName(false); setNameDraft(contactDisplayName); setNameError(null); }} type="button" variant="ghost">Cancelar</Button>
              <Button type="submit" variant="primary">Salvar nome</Button>
            </div>
          </form>
        ) : null}

        {isProvisional && (
          <Button
            aria-label="Salvar contato no ImobFlux"
            className="w-full mt-2 text-xs py-1.5"
            variant="secondary"
            onClick={() => { setIsEditingName(true); setNameError(null); }}
          >
            <UserCheck className="mr-1.5" size={14} />
            Salvar contato no ImobFlux
          </Button>
        )}
      </section>

      {/* 2. OPORTUNIDADE ATIVA & EXIBIÇÃO SOMENTE-LEITURA DA ETAPA KANBAN */}
      <section className="space-y-3 border-b border-border pb-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Oportunidade Ativa
          </h2>
          {context.all_opportunities.length > 1 && (
            <span className="text-[10px] text-text-muted font-medium">
              {context.all_opportunities.length} oportunidades
            </span>
          )}
        </div>

        {opportunities.length > 1 && onOpportunityChange && (
          <label className="block space-y-1 text-xs font-medium text-text-muted">
            <span>Oportunidade selecionada</span>
            <select
              aria-label="Selecionar oportunidade"
              className="w-full rounded-control border border-border bg-background px-2.5 py-2 text-xs font-semibold text-text focus:border-primary focus:outline-none"
              onChange={(event) => onOpportunityChange(event.target.value)}
              value={selectedOpportunityId ?? ""}
            >
              {opportunities.map((opportunityContext) => {
                const opportunity = opportunityContext.active_opportunity;
                if (!opportunity) return null;

                return (
                  <option key={opportunity.opportunity_id} value={opportunity.opportunity_id}>
                    {opportunity.title} — {opportunity.stage_name}
                  </option>
                );
              })}
            </select>
          </label>
        )}

        {activeOpp ? (
          <div className="space-y-2 rounded-control border border-border bg-background p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-xs text-text truncate">
                {activeOpp.title}
              </span>
              <Badge tone={["active", "open"].includes(activeOpp.status) ? "success" : "neutral"}>
                {formatEnumLabel(activeOpp.status)}
              </Badge>
            </div>

            {/* ETAPA DO KANBAN: APENAS LEITURA (SOMENTE LEITURA - FONTE DE VERDADE NO CABEÇALHO) */}
            <div className="flex items-center justify-between gap-2 text-xs pt-1 border-t border-border/50">
              <span className="text-text-muted font-medium">Etapa no Kanban:</span>
              <span className="font-semibold text-primary">{currentStageName}</span>
            </div>

            {activeOpp.responsible_name && (
              <p className="text-[11px] text-text-muted flex items-center gap-1">
                <UserCheck size={12} />
                <span>Responsável: {activeOpp.responsible_name}</span>
              </p>
            )}

            {activeOpp.rework_reason && (
              <div className="rounded-sm bg-danger-soft p-2 text-[11px] text-danger">
                <strong>Motivo do Retrabalho:</strong> {activeOpp.rework_reason}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-control border border-dashed border-border p-3 text-center">
            <p className="text-xs text-text-muted mb-2">Nenhuma oportunidade ativa</p>
          </div>
        )}
      </section>

      {/* 3. QUALIFICAÇÃO E DADOS DE PREFERÊNCIA */}
      <section className="space-y-3 border-b border-border pb-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Qualificação Comercial
          </h2>
          <button
            className="text-xs font-medium text-primary hover:underline"
            onClick={() => setIsEditing(!isEditing)}
            type="button"
          >
            {isEditing ? "Cancelar" : "Editar"}
          </button>
        </div>

        {isEditing ? (
          <form className="space-y-2.5 text-xs" onSubmit={handleSaveQualifications}>
            <div>
              <label className="text-[11px] font-medium text-text-muted block">Tipo de Operação</label>
              <Input onChange={(e) => setOperationType(e.target.value)} placeholder="Ex: Compra, Aluguel" value={operationType} />
            </div>
            <div>
              <label className="text-[11px] font-medium text-text-muted block">Preferência de Imóvel</label>
              <Input onChange={(e) => setPropertyType(e.target.value)} placeholder="Ex: Apartamento 3Q" value={propertyType} />
            </div>
            <div>
              <label className="text-[11px] font-medium text-text-muted block">Cidade / Região</label>
              <Input onChange={(e) => setCityRegion(e.target.value)} placeholder="Ex: Ponta Verde, Maceió" value={cityRegion} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-medium text-text-muted block">Orçamento Máx</label>
                <Input onChange={(e) => setMaxBudget(e.target.value)} placeholder="R$" type="number" value={maxBudget} />
              </div>
              <div>
                <label className="text-[11px] font-medium text-text-muted block">Entrada Disp.</label>
                <Input onChange={(e) => setDownPayment(e.target.value)} placeholder="R$" type="number" value={downPayment} />
              </div>
            </div>
            <div>
              <label className="text-[11px] font-medium text-text-muted block">Prazo / Intenção</label>
              <Input onChange={(e) => setTimeframe(e.target.value)} placeholder="Ex: 30 dias" value={timeframe} />
            </div>
            <div>
              <label className="text-[11px] font-medium text-text-muted block">Observações Gerais</label>
              <textarea
                className="w-full rounded-control border border-border bg-background p-2 text-xs text-text focus:border-primary focus:outline-none"
                onChange={(e) => setContactNotes(e.target.value)}
                rows={2}
                value={contactNotes}
              />
            </div>

            {/* SE FOR OWNER: CAMPOS DE ANÁLISE FINANCEIRA */}
            {isOwner && (
              <div className="space-y-2 border-t border-border pt-2">
                <p className="text-[11px] font-bold text-primary flex items-center gap-1">
                  <Lock size={12} /> Dados Financeiros (Somente Owner)
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] font-medium text-text-muted block">Renda Familiar</label>
                    <Input onChange={(e) => setFamilyIncome(e.target.value)} placeholder="R$" type="number" value={familyIncome} />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-text-muted block">Crédito Aprovado</label>
                    <Input onChange={(e) => setApprovedCredit(e.target.value)} placeholder="R$" type="number" value={approvedCredit} />
                  </div>
                </div>
                <div>
                  <label className="text-[11px] font-medium text-text-muted block">Status Análise</label>
                  <Input onChange={(e) => setAnalysisStatus(e.target.value)} placeholder="Ex: Aprovado CAIXA" value={analysisStatus} />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-text-muted block">Situação Documental</label>
                  <Input onChange={(e) => setDocsStatus(e.target.value)} placeholder="Ex: Completa" value={docsStatus} />
                </div>
              </div>
            )}

            <Button className="w-full mt-2" type="submit" variant="primary">
              Salvar Alterações
            </Button>
          </form>
        ) : (
          <div className="space-y-2 text-xs">
            {activeOpp?.operation_type && (
              <div className="flex items-center gap-2">
                <Building2 className="text-text-muted shrink-0" size={14} />
                <span className="text-text-muted">Operação:</span>
                <span className="font-medium">{formatEnumLabel(activeOpp.operation_type)}</span>
              </div>
            )}

            {activeOpp?.property_type_preference && (
              <div className="flex items-center gap-2">
                <Building2 className="text-text-muted shrink-0" size={14} />
                <span className="text-text-muted">Imóvel:</span>
                <span className="font-medium">{activeOpp.property_type_preference}</span>
              </div>
            )}

            {activeOpp?.city_region_preference && (
              <div className="flex items-center gap-2">
                <MapPin className="text-text-muted shrink-0" size={14} />
                <span className="text-text-muted">Região:</span>
                <span className="font-medium">{activeOpp.city_region_preference}</span>
              </div>
            )}

            <div className="flex items-center gap-2">
              <DollarSign className="text-text-muted shrink-0" size={14} />
              <span className="text-text-muted">Orçamento:</span>
              <span className="font-medium">
                {formatCurrency(activeOpp?.max_price_budget)}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <DollarSign className="text-text-muted shrink-0" size={14} />
              <span className="text-text-muted">Entrada:</span>
              <span className="font-medium">
                {formatCurrency(activeOpp?.available_down_payment)}
              </span>
            </div>

            {activeOpp?.timeframe_intent && (
              <div className="flex items-center gap-2">
                <Calendar className="text-text-muted shrink-0" size={14} />
                <span className="text-text-muted">Prazo:</span>
                <span className="font-medium">{activeOpp.timeframe_intent}</span>
              </div>
            )}

            {/* SE FOR OWNER: EXIBIÇÃO DE DADOS FINANCEIROS */}
            {isOwner && context.financial_info && (
              <div className="mt-3 rounded-control border border-border bg-neutral-soft/50 p-2.5 space-y-1.5">
                <p className="text-[11px] font-bold text-primary flex items-center gap-1">
                  <Lock size={12} /> Análise Financeira (Owner-only)
                </p>

                {context.financial_info.family_income != null && (
                  <p className="text-[11px]">
                    <span className="text-text-muted">Renda familiar:</span>{" "}
                    <span className="font-semibold">
                      {formatCurrency(context.financial_info.family_income)}
                    </span>
                  </p>
                )}

                {context.financial_info.financial_analysis_status && (
                  <p className="text-[11px]">
                    <span className="text-text-muted">Status análise:</span>{" "}
                    <span className="font-semibold">
                      {formatEnumLabel(context.financial_info.financial_analysis_status)}
                    </span>
                  </p>
                )}

                {context.financial_info.approved_credit_amount != null && (
                  <p className="text-[11px]">
                    <span className="text-text-muted">Crédito aprovado:</span>{" "}
                    <span className="font-semibold">
                      {formatCurrency(context.financial_info.approved_credit_amount)}
                    </span>
                  </p>
                )}

                {context.financial_info.docs_status && (
                  <p className="text-[11px]">
                    <span className="text-text-muted">Documentação:</span>{" "}
                    <span className="font-semibold">
                      {formatEnumLabel(context.financial_info.docs_status)}
                    </span>
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* 4. PRÓXIMA AÇÃO E FOLLOW-UP */}
      <section className="space-y-3 border-b border-border pb-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Próxima Ação & Follow-up
          </h2>
          <button
            className="text-xs text-primary font-medium flex items-center gap-1 hover:underline"
            onClick={() => setShowNewTaskForm(!showNewTaskForm)}
            type="button"
          >
            <Plus size={14} /> Nova ação
          </button>
        </div>

        {showNewTaskForm && (
          <form className="space-y-2 rounded-control border border-border bg-background p-2.5 text-xs" onSubmit={handleCreateTask}>
            <div className="flex gap-2">
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  checked={newTaskType === "task"}
                  onChange={() => setNewTaskType("task")}
                  type="radio"
                />
                Próxima Ação
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  checked={newTaskType === "follow_up"}
                  onChange={() => setNewTaskType("follow_up")}
                  type="radio"
                />
                Follow-up
              </label>
            </div>

            <Input
              onChange={(e) => setNewTaskTitle(e.target.value)}
              placeholder="Ex: Ligar amanhã para cobrar simulação"
              required
              value={newTaskTitle}
            />

            <Input
              onChange={(e) => setNewTaskDueDate(e.target.value)}
              type="datetime-local"
              value={newTaskDueDate}
            />

            <div className="flex justify-end gap-2 pt-1">
              <Button onClick={() => setShowNewTaskForm(false)} type="button" variant="ghost">
                Cancelar
              </Button>
              <Button type="submit" variant="primary">
                Salvar
              </Button>
            </div>
          </form>
        )}

        <div className="space-y-2">
          {context.tasks.length === 0 ? (
            <p className="text-xs text-text-muted">Nenhuma ação cadastrada</p>
          ) : (
            context.tasks.map((task) => (
              <div
                className={[
                  "flex items-start justify-between gap-2 rounded-control border border-border p-2.5 text-xs",
                  task.status === "completed" ? "opacity-60 bg-neutral-soft" : "bg-background",
                ].join(" ")}
                key={task.id}
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <Badge tone={task.task_type === "follow_up" ? "warning" : "info"}>
                      {task.task_type === "follow_up" ? "Follow-up" : "Próxima Ação"}
                    </Badge>
                    <span className="font-medium text-text">{task.title}</span>
                  </div>
                  <p className="text-[10px] text-text-muted flex items-center gap-1">
                    <Clock size={10} />
                    <span>Vencimento: {formatRelativeTime(task.due_at)}</span>
                  </p>
                </div>

                {task.status === "pending" && (
                  <button
                    aria-label="Concluir tarefa"
                    className="text-text-muted hover:text-success p-1"
                    onClick={() => handleCompleteTask(task.id)}
                    title="Concluir"
                    type="button"
                  >
                    <CheckCircle2 size={16} />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      {/* 5. NOTAS INTERNAS DA OPORTUNIDADE */}
      <section className="space-y-3 border-b border-border pb-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Notas internas
        </h2>

        {context.notes.length === 0 ? (
          <p className="text-xs text-text-muted">Nenhuma nota interna registrada</p>
        ) : (
          <div className="space-y-2">
            {context.notes.map((note) => (
              <article
                className="rounded-control border border-amber-500/35 bg-amber-500/10 p-2.5 text-xs"
                key={note.id}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-semibold text-amber-800 dark:text-amber-300">
                    Nota interna · não enviada ao cliente
                  </span>
                  <time className="shrink-0 text-[10px] text-text-muted">
                    {formatRelativeTime(note.created_at)}
                  </time>
                </div>
                <p className="whitespace-pre-wrap text-text">{note.content}</p>
                <p className="mt-1 text-[10px] font-medium text-text-muted">
                  por {note.author_name}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* 6. TIMELINE CONSOLIDADA */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Timeline da Operação
        </h2>

        <div className="space-y-2">
          {context.timeline.length === 0 ? (
            <p className="text-xs text-text-muted">Nenhum evento registrado</p>
          ) : (
            context.timeline.map((ev, idx) => (
              <div className="relative pl-4 text-xs border-l border-border pb-2 last:pb-0" key={idx}>
                <div className="absolute -left-[5px] top-1 h-2 w-2 rounded-full bg-primary" />
                <div className="flex items-center justify-between">
                  <span className="font-medium text-text">{ev.title}</span>
                  <span className="text-[10px] text-text-muted">
                    {formatRelativeTime(ev.occurred_at)}
                  </span>
                </div>
                <p className="text-text-muted text-[11px] mt-0.5">{ev.description}</p>
                {ev.actor && (
                  <p className="text-[10px] text-text-muted font-medium mt-0.5">
                    por {ev.actor}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
