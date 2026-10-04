"use client";

import { useId, useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { createOpportunityAction } from "@/lib/kanban/actions";
import type { ContactSelectItem, MemberSelectItem } from "@/lib/kanban/data";
import type { ContactClassification, KanbanCard } from "@/types/kanban";
import { Button, Input, ModalDialog, Select } from "@/components/ui";

interface CreateOpportunityDialogProps {
  isOpen: boolean;
  onClose: () => void;
  stages: { id: string; name: string }[];
  contacts: ContactSelectItem[];
  members: MemberSelectItem[];
  onCreated?: (card: KanbanCard, stageId: string) => void;
}

export function CreateOpportunityDialog({
  isOpen,
  onClose,
  stages,
  contacts,
  members,
  onCreated,
}: CreateOpportunityDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [origin, setOrigin] = useState("");
  const [propertySummary, setPropertySummary] = useState("");
  const [stageId, setStageId] = useState(stages[0]?.id || "");
  const [contactId, setContactId] = useState(contacts[0]?.id || "");
  const [responsibleMemberId, setResponsibleMemberId] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [isPending, startTransition] = useTransition();

  const titleId = useId();
  const descriptionId = useId();
  const stageSelectId = useId();
  const contactSelectId = useId();
  const memberSelectId = useId();

  const isDirty = Boolean(title.trim() || description.trim() || origin.trim() || propertySummary.trim());

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setOrigin("");
    setPropertySummary("");
    setErrorMsg(null);
  };

  const handleCloseAttempt = () => {
    if (isPending) return;
    if (isDirty) {
      const confirmDiscard = window.confirm(
        "Você possui alterações não salvas. Deseja realmente fechar?",
      );
      if (!confirmDiscard) return;
    }
    resetForm();
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!title.trim()) {
      setErrorMsg("Por favor, informe o título da oportunidade.");
      return;
    }
    if (!contactId) {
      setErrorMsg("Por favor, selecione um contato.");
      return;
    }
    if (!stageId) {
      setErrorMsg("Por favor, selecione uma etapa.");
      return;
    }

    startTransition(async () => {
      const res = await createOpportunityAction({
        title: title.trim(),
        description: description.trim() || undefined,
        stageId,
        contactId,
        responsibleMemberId: responsibleMemberId || undefined,
        origin: origin.trim() || undefined,
        propertySummary: propertySummary.trim() || undefined,
      });

      if (res.success) {
        const selectedContact = contacts.find((c) => c.id === contactId);
        const selectedMember = members.find((m) => m.id === responsibleMemberId);
        const now = new Date().toISOString();

        const createdCard: KanbanCard = res.opportunity || {
          id: res.opportunityId,
          title: title.trim(),
          description: description.trim() || null,
          created_at: now,
          updated_at: now,
          contact_id: contactId,
          contact_name: selectedContact?.displayName || "",
          contact_classification:
            (selectedContact?.classification as ContactClassification) || "person",
          responsible_member_id: responsibleMemberId || null,
          responsible_name: selectedMember?.displayName || null,
          has_linked_conversation: false,
          linked_conversation_id: null,
        };

        resetForm();
        onCreated?.(createdCard, stageId);
        onClose();
      } else {
        setErrorMsg(res.error || "Falha ao criar oportunidade.");
      }
    });
  };

  return (
    <ModalDialog
      className="w-[min(calc(100%_-_2rem),34rem)]"
      labelledBy="create-opportunity-dialog-title"
      onOpenChange={(open) => {
        if (!open) handleCloseAttempt();
      }}
      open={isOpen}
    >
      <div className="space-y-stack">
        {/* Cabeçalho do Modal */}
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-control bg-primary text-primary-foreground">
              <Plus aria-hidden="true" size={18} />
            </div>
            <h2 className="text-section-title font-semibold text-text" id="create-opportunity-dialog-title">
              Nova Oportunidade
            </h2>
          </div>
          <button
            aria-label="Fechar diálogo de nova oportunidade"
            className="flex size-8 items-center justify-center rounded-control text-text-muted hover:bg-neutral-soft hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            disabled={isPending}
            onClick={handleCloseAttempt}
            type="button"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>

        {/* Formulário */}
        <form className="space-y-4" onSubmit={handleSubmit}>
          {errorMsg ? (
            <p
              className="rounded-control bg-danger-soft px-control-x py-control-y text-body font-medium text-danger border border-danger-border"
              role="alert"
            >
              {errorMsg}
            </p>
          ) : null}

          {/* Título */}
          <label className="block space-y-inline" htmlFor={titleId}>
            <span className="text-body font-medium text-text">
              Título da Oportunidade <span className="text-danger">*</span>
            </span>
            <Input
              disabled={isPending}
              id={titleId}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Venda de Apto 3Q no Stella Maris"
              required
              type="text"
              value={title}
            />
          </label>

          {/* Seleção de Contato e Etapa */}
          <div className="grid grid-cols-1 gap-inline sm:grid-cols-2">
            <label className="block space-y-inline" htmlFor={contactSelectId}>
              <span className="text-body font-medium text-text">
                Contato Principal <span className="text-danger">*</span>
              </span>
              <Select
                disabled={isPending}
                id={contactSelectId}
                onChange={(e) => setContactId(e.target.value)}
                required
                value={contactId}
              >
                {contacts.length === 0 ? (
                  <option value="">Nenhum contato ativo</option>
                ) : (
                  contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.displayName}
                    </option>
                  ))
                )}
              </Select>
            </label>

            <label className="block space-y-inline" htmlFor={stageSelectId}>
              <span className="text-body font-medium text-text">
                Etapa Inicial <span className="text-danger">*</span>
              </span>
              <Select
                disabled={isPending}
                id={stageSelectId}
                onChange={(e) => setStageId(e.target.value)}
                required
                value={stageId}
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </label>
          </div>

          {/* Origem e Imóvel de Interesse */}
          <div className="grid grid-cols-1 gap-inline sm:grid-cols-2">
            <label className="block space-y-inline" htmlFor="origin-input">
              <span className="text-body font-medium text-text">
                Origem do Lead (Opcional)
              </span>
              <Input
                disabled={isPending}
                id="origin-input"
                onChange={(e) => setOrigin(e.target.value)}
                placeholder="Ex: WhatsApp, Indicação"
                type="text"
                value={origin}
              />
            </label>

            <label className="block space-y-inline" htmlFor="property-summary-input">
              <span className="text-body font-medium text-text">
                Imóvel / Produto (Opcional)
              </span>
              <Input
                disabled={isPending}
                id="property-summary-input"
                onChange={(e) => setPropertySummary(e.target.value)}
                placeholder="Ex: Lote 250m2 / Ap 3Q"
                type="text"
                value={propertySummary}
              />
            </label>
          </div>

          {/* Seleção de Responsável */}
          <label className="block space-y-inline" htmlFor={memberSelectId}>
            <span className="text-body font-medium text-text">
              Corretor Responsável (Opcional)
            </span>
            <Select
              disabled={isPending}
              id={memberSelectId}
              onChange={(e) => setResponsibleMemberId(e.target.value)}
              value={responsibleMemberId}
            >
              <option value="">Sem responsável definido</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
            </Select>
          </label>

          {/* Descrição */}
          <label className="block space-y-inline" htmlFor={descriptionId}>
            <span className="text-body font-medium text-text">
              Observações / Descrição (Opcional)
            </span>
            <textarea
              className="w-full rounded-control border border-border bg-surface px-control-x py-control-y text-body text-text placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              disabled={isPending}
              id={descriptionId}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detalhes adicionais sobre o imóvel ou preferência do cliente..."
              rows={3}
              value={description}
            />
          </label>

          {/* Ações */}
          <div className="flex justify-end gap-inline pt-3 border-t border-border">
            <Button
              disabled={isPending}
              onClick={handleCloseAttempt}
              type="button"
              variant="ghost"
            >
              Cancelar
            </Button>
            <Button disabled={isPending} type="submit" variant="primary">
              {isPending ? "Criando…" : "Criar Oportunidade"}
            </Button>
          </div>
        </form>
      </div>
    </ModalDialog>
  );
}
