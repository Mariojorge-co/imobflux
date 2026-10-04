"use client";

import { useRouter } from "next/navigation";
import { Archive, Copy, MessageCircle } from "lucide-react";
import {
  useCallback,
  useState,
  useTransition,
} from "react";
import {
  archiveOpportunityAction,
  openOrCreateOpportunityConversationAction,
  updateOpportunityAction,
} from "@/lib/kanban/actions";
import { Badge, Button, Drawer, Input, Select } from "@/components/ui";
import type {
  ContactClassification,
  KanbanCard,
  KanbanStage,
} from "@/types/kanban";

export type ContactSelectOption = {
  id: string;
  name: string;
  classification: ContactClassification;
};

export type MemberSelectOption = {
  id: string;
  name: string;
};

type OpportunityDetailDrawerProps = {
  card: KanbanCard | null;
  stages: KanbanStage[];
  contacts: ContactSelectOption[];
  members: MemberSelectOption[];
  userRole?: string;
  open: boolean;
  onClose: () => void;
  onUpdateOpportunity: (updated: KanbanCard) => void;
  onArchiveOpportunity: (opportunityId: string) => void;
};

const classificationLabels: Record<ContactClassification, string> = {
  client: "Cliente",
  lead: "Lead",
  person: "Pessoa",
};

export function OpportunityDetailDrawer({
  card,
  stages,
  contacts,
  members,
  userRole = "owner",
  open,
  onClose,
  onUpdateOpportunity,
  onArchiveOpportunity,
}: OpportunityDetailDrawerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Local form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [stageId, setStageId] = useState("");
  const [contactId, setContactId] = useState("");
  const [responsibleMemberId, setResponsibleMemberId] = useState("");
  const [feedback, setFeedback] = useState<{ type: "error" | "success"; message: string } | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const [prevCardId, setPrevCardId] = useState<string | null>(null);

  // Sync form state during render when card changes
  if (card && card.id !== prevCardId) {
    setPrevCardId(card.id);
    setTitle(card.title || "");
    setDescription(card.description || "");
    setContactId(card.contact_id || "");
    setResponsibleMemberId(card.responsible_member_id || "");
    setFeedback(null);
    setCopiedLink(false);

    const matchingStage = stages.find((s) => s.cards.some((c) => c.id === card.id));
    setStageId(matchingStage?.id || stages[0]?.id || "");
  }

  const handleOpenConversation = useCallback(() => {
    if (!card) return;
    setFeedback(null);

    startTransition(async () => {
      const res = await openOrCreateOpportunityConversationAction(card.id);
      if (res.success) {
        onClose();
        router.push(`/conversas/${res.conversationId}`);
      } else {
        setFeedback({
          type: "error",
          message:
            res.error ||
            "Não foi possível abrir a conversa. Verifique se este contato possui um telefone WhatsApp válido e se o WhatsApp está conectado.",
        });
      }
    });
  }, [card, onClose, router]);

  const handleCopyLink = useCallback(() => {
    if (!card) return;
    const url = `${window.location.origin}/kanban?opportunityId=${card.id}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  }, [card]);

  const handleArchive = useCallback(() => {
    if (!card) return;
    if (!confirm(`Deseja realmente arquivar a oportunidade "${card.title}"?`)) return;

    setFeedback(null);
    startTransition(async () => {
      // Optimistic update locally
      onArchiveOpportunity(card.id);
      onClose();

      const res = await archiveOpportunityAction(card.id);
      if (!res.success) {
        setFeedback({
          type: "error",
          message: res.error || "Falha ao arquivar oportunidade.",
        });
      }
    });
  }, [card, onArchiveOpportunity, onClose]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!card) return;

    if (!title.trim()) {
      setFeedback({ type: "error", message: "O título é obrigatório." });
      return;
    }

    setFeedback(null);

    const selectedContact = contacts.find((c) => c.id === contactId);
    const selectedMember = members.find((m) => m.id === responsibleMemberId);

    const updatedCard: KanbanCard = {
      ...card,
      title: title.trim(),
      description: description.trim() || null,
      contact_id: contactId || card.contact_id,
      contact_name: selectedContact?.name || card.contact_name,
      contact_classification: selectedContact?.classification || card.contact_classification,
      responsible_member_id: responsibleMemberId || null,
      responsible_name: selectedMember?.name || null,
      updated_at: new Date().toISOString(),
    };

    startTransition(async () => {
      // Optimistic UI update
      onUpdateOpportunity(updatedCard);

      const res = await updateOpportunityAction({
        opportunityId: card.id,
        title: title.trim(),
        description: description.trim() || undefined,
        stageId: stageId || undefined,
        contactId: contactId !== card.contact_id ? contactId : undefined,
        responsibleMemberId: responsibleMemberId || undefined,
      });

      if (res.success) {
        setFeedback({ type: "success", message: "Oportunidade atualizada com sucesso!" });
        setTimeout(() => onClose(), 600);
      } else {
        if (res.code === "CONTACT_CHANGE_BLOCKED_BY_CONVERSATION") {
          setFeedback({
            type: "error",
            message: "Não é possível alterar o contato de uma oportunidade que possui conversa vinculada.",
          });
        } else {
          setFeedback({
            type: "error",
            message: res.error || "Falha ao atualizar a oportunidade.",
          });
        }
      }
    });
  };

  if (!card) return null;

  const currentStage = stages.find((s) => s.id === stageId) || stages[0];
  const isOwner = userRole === "owner";

  return (
    <Drawer
      onClose={onClose}
      open={open}
      title="Detalhes da Oportunidade"
    >
      <div className="flex h-full flex-col">
        {/* Badges de Estado no topo do conteúdo */}
        <div className="border-b border-border bg-neutral-soft/40 px-stack py-3">
          <div className="flex flex-wrap items-center gap-2">
            {currentStage ? (
              <Badge tone="neutral">{currentStage.name}</Badge>
            ) : null}
            {card.has_linked_conversation ? (
              <Badge tone="success">Conversa Vinculada</Badge>
            ) : null}
          </div>
        </div>

        {/* Formulário e Conteúdo Principal */}
        <form className="flex-1 space-y-stack p-stack" onSubmit={handleSubmit}>
          {/* Título */}
          <label className="block space-y-inline" htmlFor="drawer-title">
            <span className="text-body font-medium text-text">Título da oportunidade</span>
            <Input
              id="drawer-title"
              name="title"
              onChange={(e) => setTitle(e.target.value)}
              required
              value={title}
            />
          </label>

          {/* Etapa do Pipeline */}
          <label className="block space-y-inline" htmlFor="drawer-stage">
            <span className="text-body font-medium text-text">Etapa no Kanban</span>
            <Select
              id="drawer-stage"
              name="stageId"
              onChange={(e) => setStageId(e.target.value)}
              value={stageId}
            >
              {stages.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name}
                </option>
              ))}
            </Select>
          </label>

          {/* Contato Principal */}
          <label className="block space-y-inline" htmlFor="drawer-contact">
            <div className="flex items-center justify-between">
              <span className="text-body font-medium text-text">Contato principal</span>
              {card.contact_classification ? (
                <span className="text-caption text-text-muted">
                  ({classificationLabels[card.contact_classification] || card.contact_classification})
                </span>
              ) : null}
            </div>
            <Select
              disabled={Boolean(card.has_linked_conversation)}
              id="drawer-contact"
              name="contactId"
              onChange={(e) => setContactId(e.target.value)}
              value={contactId}
            >
              {contacts.map((ct) => (
                <option key={ct.id} value={ct.id}>
                  {ct.name}
                </option>
              ))}
            </Select>
            {card.has_linked_conversation ? (
              <span className="block text-caption text-text-muted">
                Contato fixado por conversa vinculada ativa.
              </span>
            ) : null}
          </label>

          {/* Responsável */}
          <label className="block space-y-inline" htmlFor="drawer-responsible">
            <span className="text-body font-medium text-text">Responsável</span>
            <Select
              id="drawer-responsible"
              name="responsibleMemberId"
              onChange={(e) => setResponsibleMemberId(e.target.value)}
              value={responsibleMemberId}
            >
              <option value="">Nenhum membro atribuído</option>
              {members.map((mb) => (
                <option key={mb.id} value={mb.id}>
                  {mb.name}
                </option>
              ))}
            </Select>
          </label>

          {/* Observações / Descrição */}
          <label className="block space-y-inline" htmlFor="drawer-description">
            <span className="text-body font-medium text-text">Observações</span>
            <textarea
              className="w-full rounded-control border border-border bg-surface px-control-x py-control-y text-body text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              id="drawer-description"
              name="description"
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              value={description}
            />
          </label>

          {/* Metadados de Datas */}
          <div className="grid grid-cols-2 gap-stack rounded-card border border-border bg-neutral-soft/50 p-card text-caption text-text-muted">
            <div>
              <span className="block font-medium text-text">Criação</span>
              {card.created_at ? new Date(card.created_at).toLocaleString("pt-BR") : "-"}
            </div>
            <div>
              <span className="block font-medium text-text">Última atualização</span>
              {card.updated_at ? new Date(card.updated_at).toLocaleString("pt-BR") : "-"}
            </div>
          </div>

          {/* Notificação de Feedback */}
          {feedback ? (
            <div
              className={`rounded-control px-control-x py-control-y text-body font-medium border ${
                feedback.type === "error"
                  ? "bg-danger-soft text-danger border-danger-border"
                  : "bg-success-soft text-success border-success-border"
              }`}
              role="alert"
            >
              {feedback.message}
            </div>
          ) : null}

          {/* Ações Especiais: Abrir Conversa e Copiar Link */}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              className="flex-1 justify-center"
              disabled={isPending}
              onClick={handleOpenConversation}
              type="button"
              variant="primary"
            >
              <MessageCircle aria-hidden="true" size={16} />
              <span>Abrir conversa</span>
            </Button>

            <Button
              disabled={isPending}
              onClick={handleCopyLink}
              type="button"
              variant="secondary"
            >
              <Copy aria-hidden="true" size={16} />
              <span>{copiedLink ? "Link copiado!" : "Copiar link"}</span>
            </Button>
          </div>

          {/* Rodapé de Botões de Salvar / Arquivar */}
          <div className="mt-auto flex items-center justify-between border-t border-border pt-stack">
            {isOwner ? (
              <Button
                disabled={isPending}
                onClick={handleArchive}
                type="button"
                variant="danger"
              >
                <Archive aria-hidden="true" size={15} />
                <span>Arquivar</span>
              </Button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-inline">
              <Button onClick={onClose} type="button" variant="ghost">
                Cancelar
              </Button>
              <Button disabled={isPending} type="submit" variant="primary">
                {isPending ? "Salvando…" : "Salvar"}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </Drawer>
  );
}
