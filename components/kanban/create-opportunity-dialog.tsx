"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { createOpportunityAction } from "@/lib/kanban/actions";
import type { ContactSelectItem, MemberSelectItem } from "@/lib/kanban/data";
import type { ContactClassification, KanbanCard } from "@/types/kanban";

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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
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

  const isDirty = Boolean(title.trim() || description.trim());

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const resetForm = () => {
    setTitle("");
    setDescription("");
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

  const handleCancelEvent = (e: React.SyntheticEvent) => {
    e.preventDefault();
    handleCloseAttempt();
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
    <dialog
      ref={dialogRef}
      aria-labelledby="dialog-title"
      onCancel={handleCancelEvent}
      className="fixed inset-0 z-50 my-auto flex items-center justify-center border-none bg-transparent p-4 backdrop:bg-slate-900/50 backdrop:backdrop-blur-sm"
    >
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl border border-slate-200 text-slate-900">
        {/* Cabeçalho do Modal */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <Plus className="h-5 w-5" />
            </div>
            <h2 id="dialog-title" className="text-lg font-semibold text-slate-900">
              Nova Oportunidade
            </h2>
          </div>
          <button
            type="button"
            onClick={handleCloseAttempt}
            disabled={isPending}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
          >
            <X className="h-5 w-5" />
            <span className="sr-only">Fechar</span>
          </button>
        </div>

        {/* Formulário */}
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {errorMsg && (
            <div
              role="alert"
              className="rounded-lg bg-red-50 p-3 text-xs font-medium text-red-700 border border-red-200"
            >
              {errorMsg}
            </div>
          )}

          {/* Título */}
          <div>
            <label htmlFor={titleId} className="block text-xs font-semibold text-slate-700 mb-1">
              Título da Oportunidade <span className="text-red-500">*</span>
            </label>
            <input
              id={titleId}
              type="text"
              required
              disabled={isPending}
              placeholder="Ex: Venda de Apto 3Q no Stella Maris"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Seleção de Contato e Etapa */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={contactSelectId} className="block text-xs font-semibold text-slate-700 mb-1">
                Contato Principal <span className="text-red-500">*</span>
              </label>
              <select
                id={contactSelectId}
                required
                disabled={isPending}
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
              </select>
            </div>

            <div>
              <label htmlFor={stageSelectId} className="block text-xs font-semibold text-slate-700 mb-1">
                Etapa Inicial <span className="text-red-500">*</span>
              </label>
              <select
                id={stageSelectId}
                required
                disabled={isPending}
                value={stageId}
                onChange={(e) => setStageId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Seleção de Responsável */}
          <div>
            <label htmlFor={memberSelectId} className="block text-xs font-semibold text-slate-700 mb-1">
              Corretor Responsável (Opcional)
            </label>
            <select
              id={memberSelectId}
              disabled={isPending}
              value={responsibleMemberId}
              onChange={(e) => setResponsibleMemberId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Sem responsável definido</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
            </select>
          </div>

          {/* Descrição */}
          <div>
            <label htmlFor={descriptionId} className="block text-xs font-semibold text-slate-700 mb-1">
              Observações / Descrição (Opcional)
            </label>
            <textarea
              id={descriptionId}
              rows={3}
              disabled={isPending}
              placeholder="Detalhes adicionais sobre o imóvel ou preferência do cliente..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Ações */}
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={handleCloseAttempt}
              disabled={isPending}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {isPending ? "Criando..." : "Criar Oportunidade"}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
