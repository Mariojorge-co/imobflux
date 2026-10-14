/** Esqueletos de carregamento da tela de Conversas (sem estado, servem no servidor e no cliente). */

export function ConversationsListSkeleton() {
  return (
    <div aria-busy="true" aria-label="Carregando conversas" className="flex h-full flex-col border-r border-border bg-surface p-stack" role="status">
      <div className="h-7 w-28 animate-pulse rounded-control bg-neutral-soft" />
      <div className="mt-stack h-11 animate-pulse rounded-control bg-neutral-soft" />
      <div className="mt-stack space-y-inline">
        {Array.from({ length: 7 }, (_, index) => (
          <div className="h-[4.5rem] animate-pulse rounded-control bg-neutral-soft" key={index} />
        ))}
      </div>
    </div>
  );
}

/** Painel de mensagens enquanto a conversa abre: cabeçalho, bolhas e caixa de texto no lugar certo. */
export function ConversationPanelSkeleton() {
  return (
    <div aria-busy="true" aria-label="Abrindo conversa" className="flex h-full min-w-0 flex-col bg-background" data-testid="conversation-panel-skeleton" role="status">
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-surface px-4 py-2">
        <div className="size-9 animate-pulse rounded-full bg-neutral-soft" />
        <div className="space-y-1.5">
          <div className="h-4 w-40 animate-pulse rounded bg-neutral-soft" />
          <div className="h-3 w-28 animate-pulse rounded bg-neutral-soft" />
        </div>
      </div>
      <div className="flex flex-1 flex-col justify-end gap-3 overflow-hidden px-4 py-3">
        <div className="h-10 w-2/5 animate-pulse rounded-2xl bg-neutral-soft" />
        <div className="ml-auto h-12 w-1/3 animate-pulse rounded-2xl bg-neutral-soft" />
        <div className="h-10 w-1/2 animate-pulse rounded-2xl bg-neutral-soft" />
        <div className="ml-auto h-10 w-2/5 animate-pulse rounded-2xl bg-neutral-soft" />
      </div>
      <div className="shrink-0 border-t border-border bg-surface p-3">
        <div className="h-11 animate-pulse rounded-control bg-neutral-soft" />
      </div>
    </div>
  );
}
