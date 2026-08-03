"use client";

import Link from "next/link";
import { Archive, Pencil, Plus, RotateCcw, UserRound } from "lucide-react";
import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useFormStatus } from "react-dom";
import {
  archiveContactAction,
  changeContactStatusAction,
  createContactAction,
  restoreContactAction,
  updateContactAction,
} from "@/app/(app)/contatos/actions";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  SearchInput,
  Select,
  StatusChip,
} from "@/components/ui";
import type {
  ContactActionState,
  ContactClassification,
  ContactListFilters,
  ContactListItem,
} from "@/types/contacts";
import { initialContactActionState } from "@/types/contacts";

type FeedbackSource = "lifecycle" | "general";

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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const action = contact ? updateContactAction : createContactAction;
  const [state, formAction] = useActionState(action, initialContactActionState);

  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog) {
      return;
    }

    if (open && !dialog.open) {
      dialog.showModal();
      requestAnimationFrame(() => nameInputRef.current?.focus());
    }

    if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    if (state.status === "success") {
      onSuccess(state.message);
      onClose();
    }
  }, [onClose, onSuccess, state]);

  return (
    <dialog
      aria-labelledby="contact-form-title"
      className="w-[min(100%-2rem,34rem)] rounded-card border border-border bg-surface p-0 text-text shadow-xl backdrop:bg-text/30"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      ref={dialogRef}
    >
      <form action={formAction} className="space-y-stack p-card" onSubmit={onGeneralStart}>
        {contact ? <input name="contactId" type="hidden" value={contact.id} /> : null}
        <div>
          <h2 className="text-section-title font-semibold" id="contact-form-title">
            {contact ? "Editar contato" : "Novo contato"}
          </h2>
          <p className="mt-inline text-body text-text-muted">
            Informe somente os dados necessários para o cadastro comercial.
          </p>
        </div>

        <label className="block space-y-inline" htmlFor="contact-display-name">
          <span className="text-body font-medium">Nome</span>
          <Input
            defaultValue={contact?.displayName ?? ""}
            id="contact-display-name"
            name="displayName"
            ref={nameInputRef}
            required
          />
        </label>

        <label className="block space-y-inline" htmlFor="contact-classification">
          <span className="text-body font-medium">Classificação</span>
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
          <span className="text-body font-medium">Telefone principal</span>
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

        <div className="flex flex-wrap justify-end gap-inline">
          <Button onClick={onClose} type="button" variant="ghost">
            Cancelar
          </Button>
          <SubmitButton>{contact ? "Salvar alterações" : "Cadastrar contato"}</SubmitButton>
        </div>
      </form>
    </dialog>
  );
}

function ContactActions({
  contact,
  lifecycleAction,
  lifecycleState,
  onEdit,
  onFeedback,
  onGeneralStart,
  onLifecycleStart,
}: {
  contact: ContactListItem;
  lifecycleAction: (formData: FormData) => void;
  lifecycleState: typeof initialContactActionState;
  onEdit: (contact: ContactListItem, trigger: HTMLElement) => void;
  onFeedback: (message: string) => void;
  onGeneralStart: () => void;
  onLifecycleStart: () => void;
}) {
  const archiveDialogRef = useRef<HTMLDialogElement>(null);
  const [statusState, statusAction] = useActionState(
    changeContactStatusAction,
    initialContactActionState,
  );

  useEffect(() => {
    if (statusState.status === "success") {
      onFeedback(statusState.message);
    }
  }, [onFeedback, statusState]);

  const errorState = [statusState, lifecycleState].find(
    (state) => state.status === "error",
  );

  return (
    <div className="flex flex-wrap items-center justify-end gap-inline">
      {contact.archivedAt ? (
        <form action={lifecycleAction} onSubmit={onLifecycleStart}>
          <input name="_lifecycleOperation" type="hidden" value="restore" />
          <input name="contactId" type="hidden" value={contact.id} />
          <Button type="submit" variant="secondary">
            <RotateCcw aria-hidden="true" size={16} />
            Restaurar
          </Button>
        </form>
      ) : (
        <>
          {contact.hasMultipleActivePhones ? (
            <span className="text-caption text-text-muted">
              Edição indisponível: múltiplos telefones ativos.
            </span>
          ) : (
            <Button
              aria-label={`Editar ${contact.displayName}`}
              onClick={(event) => onEdit(contact, event.currentTarget)}
              variant="ghost"
            >
              <Pencil aria-hidden="true" size={16} />
              Editar
            </Button>
          )}
          <form action={statusAction} onSubmit={onGeneralStart}>
            <input name="contactId" type="hidden" value={contact.id} />
            <input
              name="status"
              type="hidden"
              value={contact.operationalStatus === "active" ? "inactive" : "active"}
            />
            <Button type="submit" variant="ghost">
              {contact.operationalStatus === "active" ? "Inativar" : "Reativar"}
            </Button>
          </form>
          <Button
            onClick={() => archiveDialogRef.current?.showModal()}
            variant="ghost"
          >
            <Archive aria-hidden="true" size={16} />
            Arquivar
          </Button>
        </>
      )}

      {errorState ? (
        <span className="basis-full text-right text-caption text-danger" role="alert">
          {errorState.message}
        </span>
      ) : null}

      <dialog
        aria-labelledby={`archive-contact-${contact.id}`}
        className="w-[min(100%-2rem,28rem)] rounded-card border border-border bg-surface p-0 text-text shadow-xl backdrop:bg-text/30"
        onCancel={(event) => {
          event.preventDefault();
          archiveDialogRef.current?.close();
        }}
        ref={archiveDialogRef}
      >
        <form action={lifecycleAction} className="space-y-stack p-card" onSubmit={onLifecycleStart}>
          <input name="_lifecycleOperation" type="hidden" value="archive" />
          <input name="contactId" type="hidden" value={contact.id} />
          <div>
            <h2 className="text-section-title font-semibold" id={`archive-contact-${contact.id}`}>
              Arquivar contato?
            </h2>
            <p className="mt-inline text-body text-text-muted">
              O contato sairá da listagem padrão, mas poderá ser restaurado depois.
            </p>
          </div>
          <div className="flex justify-end gap-inline">
            <Button
              onClick={() => archiveDialogRef.current?.close()}
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
      </dialog>
    </div>
  );
}

function ContactStatus({ contact }: { contact: ContactListItem }) {
  if (contact.archivedAt) {
    return <StatusChip status="neutral">Arquivado</StatusChip>;
  }

  return contact.operationalStatus === "active" ? (
    <StatusChip status="success">Ativo</StatusChip>
  ) : (
    <StatusChip status="warning">Inativo</StatusChip>
  );
}

function ContactDetails({ contact }: { contact: ContactListItem }) {
  return (
    <>
      <div>
        <p className="font-medium text-text">{contact.displayName}</p>
        <p className="mt-0.5 text-caption text-text-muted">
          {contact.hasMultipleActivePhones
            ? "Múltiplos telefones ativos"
            : (contact.phoneDisplayValue ?? "Sem telefone")}
        </p>
      </div>
    </>
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
}: ContactsClientProps) {
  const [selectedContact, setSelectedContact] = useState<ContactListItem | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
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

  const handleFeedback = useCallback((message: string) => {
    setFeedback(message);
    setFeedbackSource("general");
  }, []);

  function handleLifecycleStart() {
    setFeedbackSource("lifecycle");
    setFeedback("");
  }

  function handleGeneralStart() {
    setFeedbackSource("general");
    setFeedback("");
  }

  const displayFeedback =
    feedbackSource === "lifecycle"
      ? (!lifecyclePending && lifecycleState.status === "success"
          ? lifecycleState.message
          : "")
      : feedbackSource === "general"
      ? feedback
      : "";

  return (
    <div className="space-y-section">
      <div aria-live="polite" className="sr-only">
        {displayFeedback}
      </div>
      {displayFeedback ? (
        <p className="rounded-control bg-success-soft px-control-x py-control-y text-body text-success" role="status">
          {displayFeedback}
        </p>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-stack">
        <form className="grid flex-1 gap-inline sm:grid-cols-2 lg:grid-cols-4" method="get">
          <SearchInput
            defaultValue={filters.query}
            label="Buscar por nome ou telefone"
            name="q"
            placeholder="Nome ou telefone"
          />
          <Select aria-label="Filtrar por classificação" defaultValue={filters.classification ?? ""} name="classification">
            <option value="">Todas as classificações</option>
            <option value="lead">Lead</option>
            <option value="person">Pessoa</option>
            <option value="client">Cliente</option>
          </Select>
          <Select aria-label="Filtrar por status" defaultValue={filters.status ?? ""} name="status">
            <option value="">Todos os status</option>
            <option value="active">Ativos</option>
            <option value="inactive">Inativos</option>
          </Select>
          <Select aria-label="Filtrar por arquivamento" defaultValue={filters.archived ? "true" : "false"} name="archived">
            <option value="false">Não arquivados</option>
            <option value="true">Arquivados</option>
          </Select>
          <div className="flex gap-inline sm:col-span-2 lg:col-span-4">
            <Button type="submit" variant="secondary">Aplicar filtros</Button>
            {hasFilters ? (
              <Link
                className="inline-flex items-center justify-center rounded-control border border-transparent px-control-x py-control-y text-body font-medium text-text-muted hover:bg-neutral-soft hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                href="/contatos"
              >
                Limpar filtros
              </Link>
            ) : null}
          </div>
        </form>
        <Button onClick={(event) => openForm(null, event.currentTarget)}>
          <Plus aria-hidden="true" size={18} />
          Novo contato
        </Button>
      </div>

      {contacts.length === 0 ? (
        <EmptyState
          action={
            hasFilters ? (
              <Link className="text-body font-medium text-primary hover:text-primary-hover" href="/contatos">
                Limpar filtros
              </Link>
            ) : (
              <Button onClick={(event) => openForm(null, event.currentTarget)}>
                Novo contato
              </Button>
            )
          }
          description={
            hasFilters
              ? "Nenhum contato corresponde à busca ou aos filtros aplicados."
              : "Cadastre o primeiro contato para começar a organizar sua carteira."
          }
          icon={UserRound}
          title={hasFilters ? "Nenhum resultado encontrado" : "Nenhum contato cadastrado"}
        />
      ) : (
        <>
          <Card className="hidden overflow-x-auto p-0 md:block">
            <table className="w-full border-collapse text-left text-body">
              <thead className="border-b border-border bg-neutral-soft text-caption font-medium text-text-muted">
                <tr>
                  <th className="px-card py-stack">Contato</th>
                  <th className="px-card py-stack">Classificação</th>
                  <th className="px-card py-stack">Status</th>
                  <th className="px-card py-stack text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {contacts.map((contact) => (
                  <tr key={contact.id}>
                    <td className="px-card py-stack"><ContactDetails contact={contact} /></td>
                    <td className="px-card py-stack"><Badge tone="info">{classificationLabels[contact.classification]}</Badge></td>
                    <td className="px-card py-stack"><ContactStatus contact={contact} /></td>
                    <td className="px-card py-stack">
                      <ContactActions
                        contact={contact}
                        lifecycleAction={lifecycleAction}
                        lifecycleState={lifecycleState}
                        onEdit={openForm}
                        onFeedback={handleFeedback}
                        onGeneralStart={handleGeneralStart}
                        onLifecycleStart={handleLifecycleStart}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <div className="space-y-inline md:hidden">
            {contacts.map((contact) => (
              <Card className="space-y-stack" key={contact.id}>
                <div className="flex flex-wrap items-start justify-between gap-inline">
                  <ContactDetails contact={contact} />
                  <div className="flex flex-wrap items-center gap-inline">
                    <Badge tone="info">{classificationLabels[contact.classification]}</Badge>
                    <ContactStatus contact={contact} />
                  </div>
                </div>
                <ContactActions
                  contact={contact}
                  lifecycleAction={lifecycleAction}
                  lifecycleState={lifecycleState}
                  onEdit={openForm}
                  onFeedback={handleFeedback}
                  onGeneralStart={handleGeneralStart}
                  onLifecycleStart={handleLifecycleStart}
                />
              </Card>
            ))}
          </div>
        </>
      )}

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

      {isFormOpen ? (
        <ContactFormDialog
          key={selectedContact?.id ?? "new"}
          contact={selectedContact}
          onClose={closeForm}
          onGeneralStart={handleGeneralStart}
          onSuccess={handleFeedback}
          open={isFormOpen}
        />
      ) : null}
    </div>
  );
}
