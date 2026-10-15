-- ImobFlux: base de dados das ações sobre mensagens (responder, editar, apagar, encaminhar, reagir).
--
-- Só ADICIONA: colunas com padrão em `messages` e tabelas novas (histórico de edições, conteúdo preservado de mensagens
-- apagadas para todos, reações). Nada existente muda; o app atual ignora as colunas novas. Nenhuma linha é inserida.
--
--   * Resposta (citação): reply_to_message_id (quando a original está no CRM), reply_to_external_id (id do WhatsApp da
--     original, para citações recebidas cuja original ainda não está no CRM) e reply_snapshot (autor/trecho para exibir).
--   * Edição: edited_at/edit_count + tabela message_edits (texto anterior; só o OWNER lê).
--   * Apagar para todos: deleted_at/deleted_by_member_id/deleted_source; o texto original vai para
--     message_deletions (só o OWNER lê) e sai de messages.text_content.
--   * Apagar para mim: hidden_at/hidden_by_member_id (esconde no ImobFlux para toda a equipe; o OWNER restaura).
--   * Encaminhada: forwarded / forwarded_from_message_id.
--   * Reações: message_reactions (do membro da equipe, de um contato ou do próprio aparelho/conta).
-- Toda escrita nestas tabelas é feita só pelas funções da migration seguinte (nenhum INSERT/UPDATE/DELETE direto).

alter table public.messages
    add column reply_to_message_id uuid,
    add column reply_to_external_id text,
    add column reply_snapshot jsonb,
    add column edited_at timestamptz,
    add column edit_count smallint not null default 0,
    add column deleted_at timestamptz,
    add column deleted_by_member_id uuid,
    add column deleted_source text,
    add column hidden_at timestamptz,
    add column hidden_by_member_id uuid,
    add column forwarded boolean not null default false,
    add column forwarded_from_message_id uuid;

alter table public.messages
    add constraint fk_messages_reply_to
        foreign key (workspace_id, reply_to_message_id) references public.messages (workspace_id, id) on delete restrict,
    add constraint fk_messages_forwarded_from
        foreign key (workspace_id, forwarded_from_message_id) references public.messages (workspace_id, id) on delete restrict,
    add constraint fk_messages_deleted_by
        foreign key (workspace_id, deleted_by_member_id) references public.workspace_members (workspace_id, id) on delete restrict,
    add constraint fk_messages_hidden_by
        foreign key (workspace_id, hidden_by_member_id) references public.workspace_members (workspace_id, id) on delete restrict,
    add constraint ck_messages_deleted_source check (deleted_source is null or deleted_source in ('crm', 'whatsapp')),
    add constraint ck_messages_deleted_consistent check ((deleted_at is null) = (deleted_source is null)),
    add constraint ck_messages_hidden_consistent check ((hidden_at is null) = (hidden_by_member_id is null)),
    add constraint ck_messages_edit_count check (edit_count >= 0),
    add constraint ck_messages_reply_external_nonempty check (reply_to_external_id is null or btrim(reply_to_external_id) <> '');

create index idx_messages_reply_to on public.messages (workspace_id, reply_to_message_id) where reply_to_message_id is not null;

-- ─── Histórico de edições (só o OWNER lê) ────────────────────────────────────────────────────────

create table public.message_edits (
    id uuid not null default gen_random_uuid(),
    workspace_id uuid not null,
    message_id uuid not null,
    previous_text text,
    new_text text not null,
    edited_at timestamptz not null default now(),
    edited_by_member_id uuid,
    source text not null,

    constraint pk_message_edits primary key (id),
    constraint fk_message_edits_message
        foreign key (workspace_id, message_id) references public.messages (workspace_id, id) on delete restrict,
    constraint fk_message_edits_member
        foreign key (workspace_id, edited_by_member_id) references public.workspace_members (workspace_id, id) on delete restrict,
    constraint ck_message_edits_source check (source in ('crm', 'whatsapp')),
    constraint ck_message_edits_text check (btrim(new_text) <> '')
);
create index idx_message_edits_message on public.message_edits (workspace_id, message_id, edited_at);

-- ─── Conteúdo original de mensagens apagadas para todos (só o OWNER lê) ───────────────────────────

create table public.message_deletions (
    id uuid not null default gen_random_uuid(),
    workspace_id uuid not null,
    message_id uuid not null,
    original_text text,
    deleted_at timestamptz not null default now(),
    deleted_by_member_id uuid,
    source text not null,

    constraint pk_message_deletions primary key (id),
    constraint uq_message_deletions_message unique (message_id),
    constraint fk_message_deletions_message
        foreign key (workspace_id, message_id) references public.messages (workspace_id, id) on delete restrict,
    constraint fk_message_deletions_member
        foreign key (workspace_id, deleted_by_member_id) references public.workspace_members (workspace_id, id) on delete restrict,
    constraint ck_message_deletions_source check (source in ('crm', 'whatsapp'))
);

-- ─── Reações ─────────────────────────────────────────────────────────────────────────────────────

create table public.message_reactions (
    id uuid not null default gen_random_uuid(),
    workspace_id uuid not null,
    message_id uuid not null,
    member_id uuid,
    contact_point_id uuid,
    is_account boolean not null default false,
    emoji text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint pk_message_reactions primary key (id),
    constraint fk_message_reactions_message
        foreign key (workspace_id, message_id) references public.messages (workspace_id, id) on delete restrict,
    constraint fk_message_reactions_member
        foreign key (workspace_id, member_id) references public.workspace_members (workspace_id, id) on delete restrict,
    constraint fk_message_reactions_contact_point
        foreign key (workspace_id, contact_point_id) references public.contact_points (workspace_id, id) on delete restrict,
    constraint ck_message_reactions_one_actor check (
        (member_id is not null)::int + (contact_point_id is not null)::int + is_account::int = 1
    ),
    constraint ck_message_reactions_emoji check (btrim(emoji) <> '' and char_length(emoji) <= 16)
);
create unique index uq_message_reactions_member on public.message_reactions (message_id, member_id) where member_id is not null;
create unique index uq_message_reactions_contact on public.message_reactions (message_id, contact_point_id) where contact_point_id is not null;
create unique index uq_message_reactions_account on public.message_reactions (message_id) where is_account;
create index idx_message_reactions_message on public.message_reactions (workspace_id, message_id);

create trigger trg_message_reactions_set_updated_at
    before update on public.message_reactions
    for each row execute function public.set_updated_at();

-- ─── RLS: leitura; nenhuma escrita direta ────────────────────────────────────────────────────────

alter table public.message_edits enable row level security;
alter table public.message_deletions enable row level security;
alter table public.message_reactions enable row level security;

revoke all on table public.message_edits from public, anon, authenticated, service_role;
revoke all on table public.message_deletions from public, anon, authenticated, service_role;
revoke all on table public.message_reactions from public, anon, authenticated, service_role;
grant select on table public.message_edits to authenticated;
grant select on table public.message_deletions to authenticated;
grant select on table public.message_reactions to authenticated;

create policy message_edits_select_owner on public.message_edits
    for select to authenticated
    using (private.is_owner_in_workspace(workspace_id));

create policy message_deletions_select_owner on public.message_deletions
    for select to authenticated
    using (private.is_owner_in_workspace(workspace_id));

-- Reações: quem pode ler a mensagem (a RLS de `messages` vale dentro da subconsulta) lê as reações dela.
create policy message_reactions_select_member on public.message_reactions
    for select to authenticated
    using (
        exists (
            select 1 from public.messages as message
            where message.workspace_id = message_reactions.workspace_id
              and message.id = message_reactions.message_id
        )
    );
