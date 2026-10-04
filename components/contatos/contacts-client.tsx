"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Archive,
  MessageCircle,
  MoreVertical,
  Pencil,
  Plus,
  Power,
  RotateCcw,
  Shield,
  UserRound,
} from "lucide-react";
import {
  useActionState,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";
import { useFormStatus } from "react-dom";
import {
  archiveContactAction,
  changeContactStatusAction,
  createContactAction,
  restoreContactAction,
  updateContactAction,
  setContactTeamVisibilityAction,
} from "@/app/(app)/contatos/actions";
import { startIndividualConversationAction } from "@/lib/conversations/actions";
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  ModalDialog,
  SearchInput,
  Select,
  StatusChip,
  ViewportMenu,
} from "@/components/ui";
import { classNames } from "@/lib/class-names";
import type {
  ContactActionState,
  ContactClassification,
  ContactListFilters,
  ContactListItem,
} from "@/types/contacts";
import { initialContactActionState } from "@/types/contacts";

type FeedbackSource = "lifecycle" | "general" | "conversation";
type FeedbackTone = "error" | "success";

async function contactLifecycleAction(
  prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const operation = formData.get("_lifecycleOperation");
  if (operation === "archive") return archiveContactAction(prev, formData);
  if (operation === "restore") return restoreContactAction(prev, formData);
  return { message: "Operação de ciclo de vida inválida.", status: "error" };
}

type ContactsClientProps = {
  contacts: ContactListItem[];
  filters: ContactListFilters;
  page: number;
  total: number;
  canManagePrivacy: boolean;
};

const classificationLabels: Record<ContactClassification, string> = {
  client: "Cliente",
  lead: "Lead",
  person: "Pessoa",
};

function SubmitButton({ children }: { children: string }) {
  const { pending } = useFormStatus();

  return (
    <Button disabled={pending} type="submit">
      {pending ? "Salvando…" : children}
    </Button>
  );
}

function ContactFormDialog({
  contact,
  onClose,
  onGeneralStart,
  onSuccess,
  open,
}: {
  contact: ContactListItem | null;
  onClose: () => void;
  onGeneralStart: () => void;
  onSuccess: (message: string) => void;
  open: boolean;
}) {
  const nameInputRef = useRef<HTMLInputElement>(null);
  const action = contact ? updateContactAction : createContactAction;
  const [state, formAction] = useActionState(action, initialContactActionState);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => nameInputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (state.status === "success") {
      onSuccess(state.message);
      onClose();
    }
  }, [onClose, onSuccess, state]);

  return (
    <ModalDialog
      className="w-[min(calc(100%_-_2rem),34rem)]"
      labelledBy="contact-form-title"
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      open={open}
    >
      <form action={formAction} className="space-y-stack" onSubmit={onGeneralStart}>
        {contact ? <input name="contactId" type="hidden" value={contact.id} /> : null}
        <div>
          <h2 className="text-section-title font-semibold text-text" id="contact-form-title">
            {contact ? "Editar contato" : "Novo contato"}
          </h2>
          <p className="mt-inline text-body text-text-muted">
            Informe somente os dados necessários para o cadastro comercial.
          </p>
        </div>

        <label className="block space-y-inline" htmlFor="contact-display-name">
          <span className="text-body font-medium text-text">Nome</span>
          <Input
            defaultValue={contact?.displayName ?? ""}
            id="contact-display-name"
            name="displayName"
            ref={nameInputRef}
            required
          />
        </label>

        <label className="block space-y-inline" htmlFor="contact-classification">
          <span className="text-body font-medium text-text">Classificação</span>
          <Select
            defaultValue={contact?.classification ?? "lead"}
            id="contact-classification"
            name="classification"
          >
            <option value="lead">Lead</option>
            <option value="person">Pessoa</option>
            <option value="client">Cliente</option>
          </Select>
        </label>

        <label className="block space-y-inline" htmlFor="contact-phone">
          <span className="text-body font-medium text-text">Telefone principal</span>
          <Input
            defaultValue={contact?.phoneDisplayValue ?? ""}
            id="contact-phone"
            inputMode="tel"
            name="phone"
            placeholder="(82) 99999-9999"
          />
          <span className="block text-caption text-text-muted">
            Opcional. Use um telefone brasileiro com DDD.
          </span>
        </label>

        {state.status === "error" ? (
          <p className="rounded-control bg-danger-soft px-control-x py-control-y text-body text-danger" role="alert">
            {state.message}
          </p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-inline pt-2">
          <Button onClick={onClose} type="button" variant="ghost">
            Cancelar
          </Button>
          <SubmitButton>{contact ? "Salvar alterações" : "Cadastrar contato"}</SubmitButton>
        </div>
      </form>
    </ModalDialog>
  );
}

function ContactContextMenu({
  canManagePrivacy,
  contact,
  lifecycleAction,
  onEdit,
  onFeedback,
  onGeneralStart,
  onLifecycleStart,
  onTogglePrivacy,
}: {
  canManagePrivacy: boolean;
  contact: ContactListItem;
  lifecycleAction: (formData: FormData) => void;
  onEdit: (contact: ContactListItem, trigger: HTMLElement) => void;
  onFeedback: (message: string, tone?: FeedbackTone) => void;
  onGeneralStart: () => void;
  onLifecycleStart: () => void;
  onTogglePrivacy: (contact: ContactListItem) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const [statusState, statusAction] = useActionState(
    changeContactStatusAction,
    initialContactActionState,
  );

  useEffect(() => {
    if (statusState.status === "idle") return;
    onFeedback(statusState.message, statusState.status === "error" ? "error" : "success");
  }, [onFeedback, statusState]);

  const closeMenu = useCallback(() => {
    setIsOpen(false);
    requestAnimationFrame(() => buttonRef.current?.focus());
  }, []);

  return (
    <div className="relative inline-block text-left">
      <button
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label={`Ações secundárias para ${contact.displayName}`}
        className="flex size-9 items-center justify-center rounded-control text-text-muted hover:bg-neutral-soft hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        id={menuId}
        onClick={() => setIsOpen((prev) => !prev)}
        ref={buttonRef}
        type="button"
      >
        <MoreVertical aria-hidden="true" size={18} />
      </button>

      <ViewportMenu
        anchorRef={buttonRef}
        labelledBy={menuId}
        onClose={closeMenu}
        open={isOpen}
      >
          {contact.archivedAt ? (
            <form action={lifecycleAction} onSubmit={() => { closeMenu(); onLifecycleStart(); }}>
              <input name="_lifecycleOperation" type="hidden" value="restore" />
              <input name="contactId" type="hidden" value={contact.id} />
              <button
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-body text-text hover:bg-neutral-soft focus-visible:bg-neutral-soft focus-visible:outline-none"
                role="menuitem"
                type="submit"
              >
                <RotateCcw aria-hidden="true" size={15} />
                Restaurar contato
              </button>
            </form>
          ) : (
            <>
              {!contact.hasMultipleActivePhones ? (
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-body text-text hover:bg-neutral-soft focus-visible:bg-neutral-soft focus-visible:outline-none"
                  onClick={(e) => {
                    closeMenu();
                    onEdit(contact, e.currentTarget);
                  }}
                  role="menuitem"
                  type="button"
                >
                  <Pencil aria-hidden="true" size={15} />
                  Editar contato
                </button>
              ) : null}

              <form action={statusAction} onSubmit={() => { closeMenu(); onGeneralStart(); }}>
                <input name="contactId" type="hidden" value={contact.id} />
                <input
                  name="status"
                  type="hidden"
                  value={contact.operationalStatus === "active" ? "inactive" : "active"}
                />
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-body text-text hover:bg-neutral-soft focus-visible:bg-neutral-soft focus-visible:outline-none"
                  role="menuitem"
                  type="submit"
                >
                  <Power aria-hidden="true" size={15} />
                  {contact.operationalStatus === "active" ? "Inativar contato" : "Reativar contato"}
                </button>
              </form>

              {canManagePrivacy ? (
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-body text-text hover:bg-neutral-soft focus-visible:bg-neutral-soft focus-visible:outline-none"
                  onClick={() => {
                    closeMenu();
                    onTogglePrivacy(contact);
                  }}
                  role="menuitem"
                  type="button"
                >
                  <Shield aria-hidden="true" size={15} />
                  {contact.isProtected ? "Visível para equipe" : "Tornar OWNER-only"}
                </button>
              ) : null}

              <button
                className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-body text-danger hover:bg-danger-soft focus-visible:bg-danger-soft focus-visible:outline-none"
                onClick={() => {
                  closeMenu();
                  setIsArchiveModalOpen(true);
                }}
                role="menuitem"
                type="button"
              >
                <Archive aria-hidden="true" size={15} />
                Arquivar contato
              </button>
            </>
          )}
      </ViewportMenu>

      {statusState.status === "error" ? (
        <span className="sr-only" role="alert">
          {statusState.message}
        </span>
      ) : null}

      <ModalDialog
        labelledBy={`archive-contact-title-${contact.id}`}
        onOpenChange={setIsArchiveModalOpen}
        open={isArchiveModalOpen}
      >
        <form
          action={lifecycleAction}
          className="space-y-stack"
          onSubmit={() => {
            setIsArchiveModalOpen(false);
            onLifecycleStart();
          }}
        >
          <input name="_lifecycleOperation" type="hidden" value="archive" />
          <input name="contactId" type="hidden" value={contact.id} />
          <div>
            <h2
              className="text-section-title font-semibold text-text"
              id={`archive-contact-title-${contact.id}`}
            >
              Arquivar contato?
            </h2>
            <p className="mt-inline text-body text-text-muted">
              O contato &ldquo;{contact.displayName}&rdquo; sairá da listagem padrão, mas poderá ser restaurado a qualquer momento.
            </p>
          </div>
          <div className="flex justify-end gap-inline pt-2">
            <Button
              onClick={() => setIsArchiveModalOpen(false)}
              type="button"
              variant="ghost"
            >
              Cancelar
            </Button>
            <Button type="submit" variant="danger">
              Arquivar contato
            </Button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}

function ContactIdentity({ contact }: { contact: ContactListItem }) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <Avatar name={contact.displayName} size="sm" src={contact.avatarUrl ?? undefined} />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-text truncate text-body" title={contact.displayName}>
          {contact.displayName}
        </p>
        <p className="text-caption text-text-muted truncate">
          {contact.hasMultipleActivePhones
            ? "Múltiplos telefones ativos"
            : (contact.phoneDisplayValue ?? "Sem telefone cadastrado")}
        </p>
      </div>
    </div>
  );
}

function ContactStatusBadges({ contact }: { contact: ContactListItem }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge tone="info">{classificationLabels[contact.classification]}</Badge>
      {contact.archivedAt ? (
        <StatusChip status="neutral">Arquivado</StatusChip>
      ) : contact.operationalStatus === "active" ? (
        <StatusChip status="success">Ativo</StatusChip>
      ) : (
        <StatusChip status="warning">Inativo</StatusChip>
      )}
      {contact.isProtected ? <StatusChip status="warning">OWNER-only</StatusChip> : null}
    </div>
  );
}

function buildPageHref(filters: ContactListFilters, page: number) {
  const params = new URLSearchParams();

  if (filters.query) params.set("q", filters.query);
  if (filters.classification) params.set("classification", filters.classification);
  if (filters.status) params.set("status", filters.status);
  if (filters.archived) params.set("archived", "true");
  if (page > 1) params.set("page", String(page));

  const query = params.toString();
  return query ? `/contatos?${query}` : "/contatos";
}

export function ContactsClient({
  contacts,
  filters,
  page,
  total,
  canManagePrivacy,
}: ContactsClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [prevQuery, setPrevQuery] = useState(filters.query);
  const [searchQuery, setSearchQuery] = useState(filters.query);
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null);

  if (prevQuery !== filters.query) {
    setPrevQuery(filters.query);
    setSearchQuery(filters.query);
  }

  const [selectedContact, setSelectedContact] = useState<ContactListItem | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [feedbackTone, setFeedbackTone] = useState<FeedbackTone>("success");
  const [feedbackSource, setFeedbackSource] = useState<FeedbackSource | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const [lifecycleState, lifecycleAction, lifecyclePending] = useActionState(
    contactLifecycleAction,
    initialContactActionState,
  );
  const totalPages = Math.max(1, Math.ceil(total / 20));
  const hasFilters = Boolean(
    filters.query || filters.classification || filters.status || filters.archived,
  );

  const updateFilterParams = useCallback(
    (updated: Partial<{ archived: string; classification: string; query: string; status: string }>) => {
      const params = new URLSearchParams(searchParams.toString());

      if ("query" in updated) {
        if (updated.query && updated.query.trim()) {
          params.set("q", updated.query.trim());
        } else {
          params.delete("q");
        }
      }

      if ("classification" in updated) {
        if (updated.classification) {
          params.set("classification", updated.classification);
        } else {
          params.delete("classification");
        }
      }

      if ("status" in updated) {
        if (updated.status) {
          params.set("status", updated.status);
        } else {
          params.delete("status");
        }
      }

      if ("archived" in updated) {
        if (updated.archived === "true") {
          params.set("archived", "true");
        } else {
          params.delete("archived");
        }
      }

      params.delete("page");

      const queryStr = params.toString();
      const targetUrl = queryStr ? `${pathname}?${queryStr}` : pathname;

      startTransition(() => {
        router.replace(targetUrl, { scroll: false });
      });
    },
    [pathname, router, searchParams],
  );

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);

    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    searchDebounceRef.current = setTimeout(() => {
      updateFilterParams({ query: val });
    }, 350);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
      updateFilterParams({ query: searchQuery });
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
      setSearchQuery("");
      updateFilterParams({ query: "" });
    }
  };

  const handleClearFilters = () => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }
    setSearchQuery("");
    startTransition(() => {
      router.replace(pathname, { scroll: false });
    });
  };

  function openForm(contact: ContactListItem | null, trigger: HTMLElement) {
    triggerRef.current = trigger;
    setSelectedContact(contact);
    setIsFormOpen(true);
  }

  function closeForm() {
    setIsFormOpen(false);
    setSelectedContact(null);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  const handleFeedback = useCallback((message: string, tone: FeedbackTone = "success") => {
    setFeedback(message);
    setFeedbackTone(tone);
    setFeedbackSource("general");
  }, []);

  function handleLifecycleStart() {
    setFeedbackSource("lifecycle");
    setFeedback("");
    setFeedbackTone("success");
  }

  function handleGeneralStart() {
    setFeedbackSource("general");
    setFeedback("");
    setFeedbackTone("success");
  }

  const handleTogglePrivacy = useCallback(
    (contact: ContactListItem) => {
      startTransition(async () => {
        const res = await setContactTeamVisibilityAction(contact.id, contact.isProtected);
        if (res.success) {
          handleFeedback(
            contact.isProtected
              ? "Contato agora é visível para a equipe."
              : "Contato agora é OWNER-only (privado).",
          );
          router.refresh();
        } else {
          handleFeedback(res.error || "Falha ao alterar privacidade.");
        }
      });
    },
    [handleFeedback, router],
  );

  const handleStartConversation = useCallback(
    (contact: ContactListItem) => {
      if (!contact.phoneDisplayValue) {
        handleFeedback("Este contato não possui um telefone cadastrado.");
        return;
      }

      setFeedbackSource("conversation");
      startTransition(async () => {
        const res = await startIndividualConversationAction(contact.phoneDisplayValue!);
        if (res.success) {
          router.push(`/conversas/${res.conversationId}`);
        } else {
        handleFeedback(res.error || "Não foi possível iniciar uma conversa.", "error");
        }
      });
    },
    [handleFeedback, router],
  );

  const displayFeedback =
    feedbackSource === "lifecycle"
      ? (!lifecyclePending && lifecycleState.status === "success"
          ? lifecycleState.message
          : !lifecyclePending && lifecycleState.status === "error"
            ? lifecycleState.message
            : "")
      : feedbackSource === "general" || feedbackSource === "conversation"
      ? feedback
      : "";
  const feedbackIsError =
    feedbackSource === "lifecycle"
      ? lifecycleState.status === "error"
      : feedbackTone === "error";

  useEffect(() => {
    if (displayFeedback) {
      const timer = setTimeout(() => {
        setFeedback("");
        setFeedbackSource(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [displayFeedback]);

  return (
    <div className="space-y-section">
      <div aria-live="polite" className="sr-only">
        {displayFeedback}
      </div>
      {displayFeedback ? (
        <div
          className={classNames(
            "flex items-center justify-between rounded-control border px-control-x py-control-y text-body font-medium shadow-xs",
            feedbackIsError
              ? "border-danger-border bg-danger-soft text-danger"
              : "border-success-border bg-success-soft text-success",
          )}
          role="status"
        >
          <span>{displayFeedback}</span>
          <button
            aria-label="Fechar mensagem"
            className="ml-inline text-caption font-bold text-success hover:text-success/80"
            onClick={() => {
              setFeedback("");
              setFeedbackSource(null);
            }}
            type="button"
          >
            ✕
          </button>
        </div>
      ) : null}

      {/* Barra de Filtros e Busca */}
      <div className="flex flex-col gap-stack md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 flex-col gap-inline sm:flex-row sm:flex-wrap sm:items-center">
          <div className="w-full sm:w-64 md:w-72">
            <SearchInput
              label="Buscar por nome ou telefone"
              onChange={handleSearchChange}
              onKeyDown={handleSearchKeyDown}
              placeholder="Buscar por nome ou telefone..."
              value={searchQuery}
            />
          </div>

          <div className="grid grid-cols-2 gap-inline sm:flex sm:items-center">
            <Select
              aria-label="Filtrar por classificação"
              className="w-full sm:w-40"
              onChange={(e) => updateFilterParams({ classification: e.target.value })}
              value={filters.classification ?? ""}
            >
              <option value="">Todas classificações</option>
              <option value="lead">Lead</option>
              <option value="person">Pessoa</option>
              <option value="client">Cliente</option>
            </Select>

            <Select
              aria-label="Filtrar por status"
              className="w-full sm:w-32"
              onChange={(e) => updateFilterParams({ status: e.target.value })}
              value={filters.status ?? ""}
            >
              <option value="">Todos status</option>
              <option value="active">Ativos</option>
              <option value="inactive">Inativos</option>
            </Select>
          </div>

          <div className="flex items-center gap-inline">
            <Select
              aria-label="Filtrar por arquivamento"
              className="w-full sm:w-36"
              onChange={(e) => updateFilterParams({ archived: e.target.value })}
              value={filters.archived ? "true" : "false"}
            >
              <option value="false">Não arquivados</option>
              <option value="true">Arquivados</option>
            </Select>

            {hasFilters ? (
              <Button
                className="shrink-0 text-text-muted hover:text-text"
                onClick={handleClearFilters}
                type="button"
                variant="ghost"
              >
                Limpar filtros
              </Button>
            ) : null}
          </div>
        </div>

        <div className="shrink-0">
          <Button
            className="w-full sm:w-auto"
            onClick={(event) => openForm(null, event.currentTarget)}
          >
            <Plus aria-hidden="true" size={18} />
            <span>Novo contato</span>
          </Button>
        </div>
      </div>

      {/* Lista de Contatos */}
      <div className={classNames("relative space-y-stack transition-opacity duration-150", isPending && "opacity-60 pointer-events-none")}>
        {isPending ? (
          <div className="absolute -top-3 left-0 right-0 z-10 h-1 w-full overflow-hidden rounded-full bg-neutral-soft">
            <div className="h-full w-1/3 animate-pulse bg-primary" />
          </div>
        ) : null}

        {contacts.length === 0 ? (
          <EmptyState
            action={
              hasFilters ? (
                <Button onClick={handleClearFilters} variant="ghost">
                  Limpar filtros
                </Button>
              ) : (
                <Button onClick={(event) => openForm(null, event.currentTarget)}>
                  <Plus aria-hidden="true" size={16} />
                  Cadastrar primeiro contato
                </Button>
              )
            }
            description={
              hasFilters
                ? "Nenhum contato corresponde à busca ou aos filtros aplicados."
                : "Cadastre seu primeiro contato para começar a organizar sua carteira de clientes."
            }
            icon={UserRound}
            title={hasFilters ? "Nenhum resultado encontrado" : "Nenhum contato cadastrado"}
          />
        ) : (
          <>
            {/* Tabela Desktop */}
            <Card className="hidden overflow-x-auto p-0 md:block">
              <table className="w-full border-collapse text-left text-body">
                <thead className="border-b border-border bg-neutral-soft text-caption font-medium text-text-muted">
                  <tr>
                    <th className="px-card py-2.5">Contato</th>
                    <th className="px-card py-2.5">Classificação / Status</th>
                    <th className="px-card py-2.5">Ação Principal</th>
                    <th className="px-card py-2.5 text-right w-14">
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {contacts.map((contact) => (
                    <tr className="hover:bg-neutral-soft/40 transition-colors" key={contact.id}>
                      <td className="px-card py-2.5">
                        <ContactIdentity contact={contact} />
                      </td>
                      <td className="px-card py-2.5">
                        <ContactStatusBadges contact={contact} />
                      </td>
                      <td className="px-card py-2.5">
                        {contact.conversationId ? (
                          <Link
                            aria-label={`Abrir conversa com ${contact.displayName}`}
                            className="inline-flex items-center gap-1.5 rounded-control px-2.5 py-1.5 text-body font-medium text-primary hover:bg-neutral-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            href={`/conversas/${contact.conversationId}`}
                          >
                            <MessageCircle aria-hidden="true" className="text-success" size={16} />
                            <span>Abrir conversa</span>
                          </Link>
                        ) : (
                          <Button
                            aria-label={`Iniciar conversa com ${contact.displayName}`}
                            className="inline-flex items-center gap-1.5"
                            disabled={isPending || !contact.phoneDisplayValue}
                            onClick={() => handleStartConversation(contact)}
                            title={!contact.phoneDisplayValue ? "Cadastre um telefone para conversar" : undefined}
                            type="button"
                            variant="secondary"
                          >
                            <MessageCircle aria-hidden="true" size={15} />
                            <span>Iniciar conversa</span>
                          </Button>
                        )}
                      </td>
                      <td className="px-card py-2.5 text-right">
                        <ContactContextMenu
                          canManagePrivacy={canManagePrivacy}
                          contact={contact}
                          lifecycleAction={lifecycleAction}
                          onEdit={openForm}
                          onFeedback={handleFeedback}
                          onGeneralStart={handleGeneralStart}
                          onLifecycleStart={handleLifecycleStart}
                          onTogglePrivacy={handleTogglePrivacy}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            {/* Cards Mobile */}
            <div className="space-y-inline md:hidden">
              {contacts.map((contact) => (
                <Card className="p-3.5 space-y-3" key={contact.id}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <ContactIdentity contact={contact} />
                    </div>
                    <div className="shrink-0 -mr-1.5 -mt-1">
                      <ContactContextMenu
                        canManagePrivacy={canManagePrivacy}
                        contact={contact}
                        lifecycleAction={lifecycleAction}
                        onEdit={openForm}
                        onFeedback={handleFeedback}
                        onGeneralStart={handleGeneralStart}
                        onLifecycleStart={handleLifecycleStart}
                        onTogglePrivacy={handleTogglePrivacy}
                      />
                    </div>
                  </div>

                  <ContactStatusBadges contact={contact} />

                  <div className="pt-1 border-t border-border">
                    {contact.conversationId ? (
                      <Link
                        aria-label={`Abrir conversa com ${contact.displayName}`}
                        className="flex w-full items-center justify-center gap-2 rounded-control bg-primary px-control-x py-control-y text-body font-medium text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        href={`/conversas/${contact.conversationId}`}
                      >
                        <MessageCircle aria-hidden="true" size={17} />
                        <span>Abrir conversa</span>
                      </Link>
                    ) : (
                      <Button
                        aria-label={`Iniciar conversa com ${contact.displayName}`}
                        className="w-full justify-center"
                        disabled={isPending || !contact.phoneDisplayValue}
                        onClick={() => handleStartConversation(contact)}
                        title={!contact.phoneDisplayValue ? "Cadastre um telefone para conversar" : undefined}
                        type="button"
                        variant="secondary"
                      >
                        <MessageCircle aria-hidden="true" size={17} />
                        <span>Iniciar conversa</span>
                      </Button>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Paginação */}
      {total > 0 ? (
        <nav aria-label="Paginação de contatos" className="flex items-center justify-between gap-stack">
          <p className="text-body text-text-muted">
            {total} {total === 1 ? "contato" : "contatos"} · página {page} de {totalPages}
          </p>
          <div className="flex gap-inline">
            {page > 1 ? (
              <Link
                className="inline-flex items-center justify-center rounded-control border border-border-strong bg-surface px-control-x py-control-y text-body font-medium text-text hover:bg-neutral-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                href={buildPageHref(filters, page - 1)}
              >
                Anterior
              </Link>
            ) : null}
            {page < totalPages ? (
              <Link
                className="inline-flex items-center justify-center rounded-control border border-border-strong bg-surface px-control-x py-control-y text-body font-medium text-text hover:bg-neutral-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                href={buildPageHref(filters, page + 1)}
              >
                Próxima
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}

      {/* Diálogo de Criação/Edição */}
      {isFormOpen ? (
        <ContactFormDialog
          contact={selectedContact}
          key={selectedContact?.id ?? "new"}
          onClose={closeForm}
          onGeneralStart={handleGeneralStart}
          onSuccess={handleFeedback}
          open={isFormOpen}
        />
      ) : null}
    </div>
  );
}
