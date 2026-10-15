"use client";

import { useState, useTransition, type ReactNode } from "react";
import { CategoryFormDialog } from "@/components/quick-replies/category-form-dialog";
import { ConfirmDialog } from "@/components/quick-replies/confirm-dialog";
import { QuickReplyFormDialog } from "@/components/quick-replies/quick-reply-form-dialog";
import { deleteQuickReplyAction, deleteQuickReplyCategoryAction } from "@/lib/quick-replies/actions";
import type { QuickReply, QuickReplyCategory, QuickReplyLibrary } from "@/lib/quick-replies/types";

type ReplyForm = { reply: QuickReply | null; defaultCategoryId: string | null };
type DeleteTarget = { kind: "reply"; reply: QuickReply } | { kind: "category"; category: QuickReplyCategory };

/**
 * Criar, editar e apagar respostas e categorias (formulários e confirmações), usado pelo painel da conversa e pela tela
 * de Configurações. Depois de qualquer mudança chama `onChanged` para recarregar a lista.
 */
export function useQuickReplyEditors(library: QuickReplyLibrary | null, onChanged: () => void) {
  const [replyForm, setReplyForm] = useState<ReplyForm | null>(null);
  const [categoryForm, setCategoryForm] = useState<{ category: QuickReplyCategory | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, startDelete] = useTransition();

  const confirmDelete = () => {
    if (!deleteTarget) return;
    setDeleteError(null);
    startDelete(async () => {
      const result =
        deleteTarget.kind === "reply"
          ? await deleteQuickReplyAction(deleteTarget.reply.id)
          : await deleteQuickReplyCategoryAction(deleteTarget.category.id);
      if (result.success) {
        setDeleteTarget(null);
        onChanged();
      } else {
        setDeleteError(result.error);
      }
    });
  };

  const dialogs: ReactNode = (
    <>
      <QuickReplyFormDialog
        categories={library?.categories ?? []}
        defaultCategoryId={replyForm?.defaultCategoryId}
        onClose={() => setReplyForm(null)}
        onSaved={() => {
          setReplyForm(null);
          onChanged();
        }}
        open={replyForm !== null}
        reply={replyForm?.reply ?? null}
      />
      <CategoryFormDialog
        category={categoryForm?.category ?? null}
        onClose={() => setCategoryForm(null)}
        onSaved={() => {
          setCategoryForm(null);
          onChanged();
        }}
        open={categoryForm !== null}
      />
      <ConfirmDialog
        confirmLabel="Apagar"
        description={
          deleteTarget?.kind === "category"
            ? "As respostas desta categoria não serão apagadas: elas passam para “Sem categoria”."
            : "Esta resposta deixa de existir para toda a equipe. Não dá para desfazer."
        }
        destructive
        error={deleteError}
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteError(null);
        }}
        onConfirm={confirmDelete}
        open={deleteTarget !== null}
        pending={isDeleting}
        title={
          deleteTarget?.kind === "category"
            ? `Apagar a categoria “${deleteTarget.category.name}”?`
            : deleteTarget
              ? `Apagar a resposta “${deleteTarget.reply.title}”?`
              : ""
        }
      />
    </>
  );

  return {
    dialogs,
    newReply: (defaultCategoryId: string | null = null) => setReplyForm({ reply: null, defaultCategoryId }),
    editReply: (reply: QuickReply) => setReplyForm({ reply, defaultCategoryId: null }),
    newCategory: () => setCategoryForm({ category: null }),
    editCategory: (category: QuickReplyCategory) => setCategoryForm({ category }),
    deleteReply: (reply: QuickReply) => {
      setDeleteError(null);
      setDeleteTarget({ kind: "reply", reply });
    },
    deleteCategory: (category: QuickReplyCategory) => {
      setDeleteError(null);
      setDeleteTarget({ kind: "category", category });
    },
  };
}
