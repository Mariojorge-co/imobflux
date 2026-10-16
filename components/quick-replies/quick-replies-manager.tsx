"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Plus, Zap } from "lucide-react";
import { Button, Card, EmptyState } from "@/components/ui";
import { AttachmentBadge } from "@/components/quick-replies/attachment-badge";
import { HighlightedText } from "@/components/quick-replies/highlighted-text";
import { ItemMenu } from "@/components/quick-replies/item-menu";
import { useQuickReplyEditors } from "@/components/quick-replies/use-quick-reply-editors";
import { useQuickReplies } from "@/components/quick-replies/use-quick-replies";
import { addExampleQuickRepliesAction } from "@/lib/quick-replies/actions";
import { canManageItem } from "@/lib/quick-replies/permissions";
import type { QuickReply, QuickReplyCategory, QuickReplyLibrary } from "@/lib/quick-replies/types";
import { PREVIEW_CONTEXT, QUICK_REPLY_VARIABLES, resolveVariables } from "@/lib/quick-replies/variables";

function formatLastUse(value: string | null): string {
  if (!value) return "nunca usada";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "nunca usada";
  return `último uso em ${date.toLocaleDateString("pt-BR", { timeZone: "America/Maceio" })}`;
}

type Group = { category: QuickReplyCategory | null; replies: QuickReply[] };

/** Gestão de respostas rápidas e categorias em Configurações, com pré-visualização das variáveis. */
export function QuickRepliesManager({ initialLibrary }: { initialLibrary: QuickReplyLibrary | null }) {
  const { library, state, error, reload } = useQuickReplies(initialLibrary);
  const editors = useQuickReplyEditors(library, () => void reload());
  const [exampleError, setExampleError] = useState<string | null>(null);
  const [isAddingExamples, startExamples] = useTransition();

  const groups = useMemo<Group[]>(() => {
    if (!library) return [];
    const byName = (a: QuickReplyCategory, b: QuickReplyCategory) =>
      a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
    const byTitle = (a: QuickReply, b: QuickReply) => a.title.localeCompare(b.title, "pt-BR", { sensitivity: "base" });
    const known = new Set(library.categories.map((category) => category.id));
    const result: Group[] = [...library.categories].sort(byName).map((category) => ({
      category,
      replies: library.replies.filter((reply) => reply.category_id === category.id).sort(byTitle),
    }));
    result.push({
      category: null,
      replies: library.replies.filter((reply) => !reply.category_id || !known.has(reply.category_id)).sort(byTitle),
    });
    return result;
  }, [library]);

  if (!library) {
    return (
      <Card className="max-w-xl">
        <p className="text-body text-danger" role="alert">
          {error ?? "Não foi possível carregar as respostas rápidas."}
        </p>
        <Button className="mt-3" onClick={() => void reload()} variant="secondary">
          Tentar novamente
        </Button>
        {state === "loading" ? <p className="mt-2 text-caption text-text-muted">Carregando…</p> : null}
      </Card>
    );
  }

  const addExamples = () => {
    setExampleError(null);
    startExamples(async () => {
      const result = await addExampleQuickRepliesAction();
      if (result.success) void reload();
      else setExampleError(result.error);
    });
  };

  return (
    <div className="space-y-stack">
      <p className="max-w-3xl text-body text-text-muted">
        Modelos de mensagem para toda a equipe. Na conversa, use o botão ⚡ ou digite “/”: o texto entra na caixa para você
        revisar e só é enviado quando você enviar. Cada pessoa edita o que criou; o proprietário edita tudo.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => editors.newReply()}>
          <Plus aria-hidden="true" size={16} /> Nova resposta
        </Button>
        <Button onClick={() => editors.newCategory()} variant="secondary">
          <Plus aria-hidden="true" size={16} /> Nova categoria
        </Button>
        <Link
          className="inline-flex min-h-11 items-center rounded-control px-3 text-body text-text-muted underline-offset-2 hover:text-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          href="/conversas"
        >
          Voltar às conversas
        </Link>
      </div>

      <Card className="max-w-3xl">
        <h2 className="text-body font-semibold text-text">Variáveis disponíveis</h2>
        <ul className="mt-2 grid gap-1 text-caption text-text-muted sm:grid-cols-2">
          {QUICK_REPLY_VARIABLES.map((variable) => (
            <li key={variable.key}>
              <code className="rounded-sm bg-neutral-soft px-1 text-text">{variable.token}</code> — {variable.label} (ex.:{" "}
              {variable.example})
            </li>
          ))}
        </ul>
        <p className="mt-2 text-caption text-text-muted">
          Outros campos, como {"{{imovel}}"}, ficam como estão para você preencher na caixa. Se sobrar algum ao enviar, o
          sistema pergunta antes.
        </p>
      </Card>

      {library.replies.length === 0 ? (
        <EmptyState
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => editors.newReply()}>Nova resposta</Button>
              <Button disabled={isAddingExamples} onClick={addExamples} variant="secondary">
                {isAddingExamples ? "Adicionando…" : "Adicionar exemplos"}
              </Button>
            </div>
          }
          description="Crie modelos de mensagem ou comece com 5 exemplos prontos (boas-vindas, documentos, visita, localização e follow-up) e edite como quiser."
          icon={Zap}
          title="Nenhuma resposta rápida ainda"
        />
      ) : null}
      {exampleError ? (
        <p className="text-caption text-danger" role="alert">
          {exampleError}
        </p>
      ) : null}

      <div className="max-w-3xl space-y-stack">
        {groups.map((group) => {
          if (!group.category && group.replies.length === 0) return null;
          const name = group.category?.name ?? "Sem categoria";
          const category = group.category;
          const manageCategory = category ? canManageItem(library.me, category.created_by_member_id) : false;
          return (
            <section aria-label={name} data-testid="manager-group" key={category?.id ?? "none"}>
              <div className="mb-1 flex items-center justify-between">
                <h2 className="text-body font-semibold text-text">
                  {name} <span className="font-normal text-text-muted">({group.replies.length})</span>
                </h2>
                {category && manageCategory ? (
                  <ItemMenu
                    label={`categoria ${category.name}`}
                    onDelete={() => editors.deleteCategory(category)}
                    onEdit={() => editors.editCategory(category)}
                  />
                ) : null}
              </div>
              {group.replies.length === 0 ? (
                <p className="rounded-control border border-dashed border-border px-3 py-3 text-caption text-text-muted">
                  Nenhuma resposta nesta categoria.
                </p>
              ) : (
                <ul className="space-y-2">
                  {group.replies.map((reply) => {
                    const manage = canManageItem(library.me, reply.created_by_member_id);
                    return (
                      <li data-testid="manager-reply" key={reply.id}>
                        <Card className="p-3">
                          <div className="flex items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="flex flex-wrap items-center gap-2 text-body font-semibold text-text">
                                {reply.title}
                                <AttachmentBadge count={reply.attachments?.length ?? 0} />
                                {!reply.is_active ? (
                                  <span className="rounded-full bg-neutral-soft px-2 text-caption font-medium text-text-muted">
                                    Inativa
                                  </span>
                                ) : null}
                              </p>
                              <p className="text-caption text-text-muted">
                                {reply.created_by_member_id === library.me.member_id ? "Criada por você · " : ""}
                                usada {reply.use_count} {reply.use_count === 1 ? "vez" : "vezes"} · {formatLastUse(reply.last_used_at)}
                              </p>
                              <div className="mt-1.5 line-clamp-4 text-body text-text" title="Pré-visualização com dados de exemplo">
                                <HighlightedText text={resolveVariables(reply.body, PREVIEW_CONTEXT)} />
                              </div>
                            </div>
                            {manage ? (
                              <ItemMenu label={reply.title} onDelete={() => editors.deleteReply(reply)} onEdit={() => editors.editReply(reply)} />
                            ) : null}
                          </div>
                        </Card>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {editors.dialogs}
    </div>
  );
}
