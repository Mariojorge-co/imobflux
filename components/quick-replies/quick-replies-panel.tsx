"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Plus, Search, Settings2, X, Zap } from "lucide-react";
import { Button } from "@/components/ui";
import { ESCAPE_PRIORITY, useEscapeLayer } from "@/lib/ui/escape-stack";
import { captureFocusTarget } from "@/lib/ui/focus-return";
import { AttachmentBadge } from "@/components/quick-replies/attachment-badge";
import { HighlightedText } from "@/components/quick-replies/highlighted-text";
import { ItemMenu } from "@/components/quick-replies/item-menu";
import { useQuickReplyEditors } from "@/components/quick-replies/use-quick-reply-editors";
import type { QuickReplyLoadState } from "@/components/quick-replies/use-quick-replies";
import { addExampleQuickRepliesAction } from "@/lib/quick-replies/actions";
import { filterReplies, groupByCategory, type QuickReplyChip } from "@/lib/quick-replies/filter";
import { canManageItem } from "@/lib/quick-replies/permissions";
import type { QuickReply, QuickReplyLibrary } from "@/lib/quick-replies/types";

type QuickRepliesPanelProps = {
  open: boolean;
  onClose: () => void;
  library: QuickReplyLibrary | null;
  state: QuickReplyLoadState;
  error: string | null;
  /** Recarrega a lista (depois de criar/editar/apagar ou depois de uma falha). */
  onReload: () => void;
  /** Insere a resposta na caixa de mensagem (nunca envia). */
  onInsert: (reply: QuickReply) => void;
};

const chipClass = (active: boolean) =>
  [
    "min-h-9 shrink-0 rounded-full border px-3 text-caption font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
    active
      ? "border-primary bg-primary/10 text-primary"
      : "border-border-strong bg-surface text-text-muted hover:bg-neutral-soft hover:text-text",
  ].join(" ");

/**
 * Painel de respostas rápidas: drawer à direita no desktop, "bottom sheet" no celular. Clicar numa resposta a INSERE na
 * caixa de mensagem e fecha o painel; o envio é sempre uma ação separada de quem atende.
 */
export function QuickRepliesPanel({ open, onClose, library, state, error, onReload, onInsert }: QuickRepliesPanelProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState<QuickReplyChip>("all");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [exampleError, setExampleError] = useState<string | null>(null);
  const [isAddingExamples, startExamples] = useTransition();
  const editors = useQuickReplyEditors(library, onReload);
  // Esc fecha o painel como uma camada (uma por vez, por cima da conversa).
  useEscapeLayer(open, ESCAPE_PRIORITY.drawer, () => {
    onClose();
  });

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = captureFocusTarget();
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as Element | null;
      // Esc e Tab dentro de formulários/menus abertos por cima do painel pertencem a eles.
      if (target?.closest?.('dialog, [role="menu"]')) return;
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = [
        ...panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [onClose, open]);

  const replies = useMemo(() => library?.replies ?? [], [library]);
  const categories = useMemo(() => library?.categories ?? [], [library]);
  const visible = useMemo(() => filterReplies(replies, query, chip), [replies, query, chip]);
  const groups = useMemo(() => groupByCategory(visible, categories), [visible, categories]);
  const flat = chip === "top";
  const searching = query.trim() !== "";
  const hasAnyActive = replies.some((reply) => reply.is_active);

  if (!open) return null;

  const toggleGroup = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const renderItem = (reply: QuickReply) => {
    const isExpanded = expanded === reply.id;
    const manage = library ? canManageItem(library.me, reply.created_by_member_id) : false;
    return (
      <li className="border-b border-border/60 last:border-b-0" data-testid="quick-reply-item" key={reply.id}>
        <div className="flex items-start gap-1 pr-1">
          <button
            className="min-h-11 min-w-0 flex-1 px-stack py-2 text-left hover:bg-neutral-soft focus-visible:bg-neutral-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
            data-testid="quick-reply-insert"
            onClick={() => onInsert(reply)}
            type="button"
          >
            <span className="block truncate text-body font-semibold text-text">
              {reply.title}
              <AttachmentBadge count={reply.attachments?.length ?? 0} />
            </span>
            {!isExpanded ? (
              <span className="mt-0.5 line-clamp-2 whitespace-pre-line break-words text-caption text-text-muted">{reply.body}</span>
            ) : null}
          </button>
          <button
            aria-expanded={isExpanded}
            aria-label={isExpanded ? `Recolher o texto de ${reply.title}` : `Ver o texto completo de ${reply.title}`}
            className="flex size-11 shrink-0 items-center justify-center rounded-control text-text-muted hover:bg-neutral-soft hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => setExpanded(isExpanded ? null : reply.id)}
            type="button"
          >
            <ChevronDown aria-hidden="true" className={isExpanded ? "rotate-180" : ""} size={18} />
          </button>
          {manage ? (
            <ItemMenu label={reply.title} onDelete={() => editors.deleteReply(reply)} onEdit={() => editors.editReply(reply)} />
          ) : null}
        </div>
        {isExpanded ? (
          <div className="mx-stack mb-2 max-h-60 overflow-y-auto rounded-control bg-neutral-soft p-2.5 text-body text-text" data-testid="quick-reply-full-text">
            <HighlightedText text={reply.body} />
          </div>
        ) : null}
      </li>
    );
  };

  const addExamples = () => {
    setExampleError(null);
    startExamples(async () => {
      const result = await addExampleQuickRepliesAction();
      if (result.success) onReload();
      else setExampleError(result.error);
    });
  };

  let body: ReactNode;
  if (state === "loading" || (state === "idle" && !library)) {
    body = (
      <p className="px-stack py-8 text-center text-body text-text-muted" role="status">
        Carregando respostas rápidas…
      </p>
    );
  } else if (state === "error" && !library) {
    body = (
      <div className="space-y-3 px-stack py-8 text-center" role="alert">
        <p className="text-body text-danger">{error ?? "Não foi possível carregar as respostas rápidas."}</p>
        <Button onClick={onReload} variant="secondary">
          Tentar novamente
        </Button>
      </div>
    );
  } else if (!hasAnyActive) {
    body = (
      <div className="space-y-3 px-stack py-8 text-center" data-testid="quick-replies-empty">
        <Zap aria-hidden="true" className="mx-auto text-text-muted" size={28} />
        <p className="text-body font-semibold text-text">Nenhuma resposta rápida ainda</p>
        <p className="text-caption text-text-muted">
          Crie modelos de mensagem para toda a equipe usar. Clicar num modelo só coloca o texto na caixa; você revisa e envia.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={() => editors.newReply()}>
            <Plus aria-hidden="true" size={16} /> Nova resposta
          </Button>
          {replies.length === 0 ? (
            <Button disabled={isAddingExamples} onClick={addExamples} variant="secondary">
              {isAddingExamples ? "Adicionando…" : "Adicionar exemplos"}
            </Button>
          ) : null}
        </div>
        {exampleError ? (
          <p className="text-caption text-danger" role="alert">
            {exampleError}
          </p>
        ) : null}
      </div>
    );
  } else if (visible.length === 0) {
    body = (
      <p className="px-stack py-8 text-center text-body text-text-muted" data-testid="quick-replies-no-results" role="status">
        {chip === "top" && !searching
          ? "Ainda não há respostas usadas. As mais usadas aparecem aqui."
          : "Nenhuma resposta encontrada para esse filtro."}
      </p>
    );
  } else if (flat) {
    body = <ul>{visible.map(renderItem)}</ul>;
  } else {
    body = (
      <div>
        {groups.map((group) => {
          const key = group.category?.id ?? "none";
          const isOpen = searching || !collapsed.has(key);
          const name = group.category?.name ?? "Sem categoria";
          const manageCategory = group.category && library ? canManageItem(library.me, group.category.created_by_member_id) : false;
          return (
            <section aria-label={name} data-testid="quick-reply-group" key={key}>
              <div className="flex items-center border-y border-border/60 bg-neutral-soft/60">
                <button
                  aria-expanded={isOpen}
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-1.5 px-stack text-left text-caption font-semibold uppercase tracking-wide text-text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                  onClick={() => toggleGroup(key)}
                  type="button"
                >
                  {isOpen ? <ChevronDown aria-hidden="true" size={15} /> : <ChevronRight aria-hidden="true" size={15} />}
                  <span className="truncate">{name}</span>
                  <span className="font-normal">({group.replies.length})</span>
                </button>
                {manageCategory && group.category ? (
                  <ItemMenu
                    label={`categoria ${group.category.name}`}
                    onDelete={() => editors.deleteCategory(group.category!)}
                    onEdit={() => editors.editCategory(group.category!)}
                  />
                ) : null}
              </div>
              {isOpen ? <ul>{group.replies.map(renderItem)}</ul> : null}
            </section>
          );
        })}
      </div>
    );
  }

  const categoryValue = typeof chip === "object" ? chip.categoryId : "";

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-end sm:items-stretch sm:justify-end">
        <button aria-label="Fechar respostas rápidas" className="absolute inset-0 bg-text/40" onClick={onClose} tabIndex={-1} type="button" />
        <aside
          aria-label="Respostas rápidas"
          aria-modal="true"
          className="relative flex max-h-[85dvh] w-full flex-col rounded-t-2xl bg-surface shadow-2xl sm:h-full sm:max-h-none sm:w-[28rem] sm:rounded-none"
          data-testid="quick-replies-panel"
          ref={panelRef}
          role="dialog"
        >
          <header className="flex min-h-14 shrink-0 items-center justify-between border-b border-border px-stack">
            <h2 className="flex items-center gap-2 text-body font-semibold text-text">
              <Zap aria-hidden="true" size={18} /> Respostas rápidas
            </h2>
            <button
              aria-label="Fechar respostas rápidas"
              className="flex size-11 items-center justify-center rounded-control text-text-muted hover:bg-neutral-soft hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              onClick={onClose}
              type="button"
            >
              <X aria-hidden="true" size={20} />
            </button>
          </header>

          <div className="shrink-0 space-y-2 border-b border-border px-stack py-2">
            <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={16} />
              <input
                aria-label="Buscar respostas rápidas"
                className="min-h-11 w-full rounded-control border border-border-strong bg-surface pl-9 pr-3 text-body text-text outline-none placeholder:text-text-muted focus:border-primary focus:ring-2 focus:ring-primary/15"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar por título ou texto"
                ref={searchRef}
                type="search"
                value={query}
              />
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5" role="group" aria-label="Filtros">
              <button aria-pressed={chip === "all"} className={chipClass(chip === "all")} onClick={() => setChip("all")} type="button">
                Tudo
              </button>
              <button aria-pressed={chip === "top"} className={chipClass(chip === "top")} onClick={() => setChip("top")} type="button">
                Mais usadas
              </button>
              <button aria-pressed={chip === "none"} className={chipClass(chip === "none")} onClick={() => setChip("none")} type="button">
                Sem categoria
              </button>
              {categories.length > 0 ? (
                <select
                  aria-label="Filtrar por categoria"
                  className={`${chipClass(categoryValue !== "")} max-w-44 bg-transparent`}
                  onChange={(event) => setChip(event.target.value ? { categoryId: event.target.value } : "all")}
                  value={categoryValue}
                >
                  <option value="">Categorias</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto" data-testid="quick-replies-list">
            {body}
          </div>

          <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-stack py-2">
            <Button className="min-h-10 px-3" onClick={() => editors.newReply(typeof chip === "object" ? chip.categoryId : null)} variant="secondary">
              <Plus aria-hidden="true" size={15} /> Nova resposta
            </Button>
            <Button className="min-h-10 px-3" onClick={() => editors.newCategory()} variant="secondary">
              <Plus aria-hidden="true" size={15} /> Nova categoria
            </Button>
            <Link
              className="ml-auto inline-flex min-h-10 items-center gap-1 rounded-control px-2 text-caption font-medium text-text-muted underline-offset-2 hover:text-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              href="/configuracoes/respostas-rapidas"
            >
              <Settings2 aria-hidden="true" size={14} /> Gerenciar
            </Link>
          </footer>
        </aside>
      </div>
      {editors.dialogs}
    </>
  );
}
