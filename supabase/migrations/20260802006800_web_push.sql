-- ImobFlux: avisos de mensagem nova com o app fechado (Web Push). Tudo ADITIVO: uma tabela nova e três funções novas; nada que já
-- existe muda (o app anterior continua funcionando com o banco já migrado; sem as chaves VAPID o recurso fica desligado).
--
-- 1) public.push_subscriptions: uma linha por aparelho da pessoa (endpoint do serviço de push + chaves públicas do aparelho). RLS: cada
--    pessoa só lê, cria e apaga as PRÓPRIAS assinaturas e só altera a opção "avisar também prazo desativado" delas. O envio usa a chave
--    de serviço no servidor (service_role: lê as assinaturas dos destinatários e marca erro/desativação).
-- 2) public.register_push_subscription: grava a assinatura do aparelho para a pessoa logada (idempotente por endpoint; se o mesmo aparelho
--    estava cadastrado para OUTRA pessoa, a linha antiga é removida — o aparelho agora é de quem entrou).
-- 3) public.get_push_targets(message_id): SÓ service_role. Quem recebe o aviso de uma mensagem, com as MESMAS regras do avisador atual
--    (lib/notifications/model.ts): só mensagem de cliente (não da equipe, não histórico, não apagada/escondida), conversa aberta, não é a
--    conversa do número com ele mesmo, grupo não liberado não avisa, prazo desativado só com a opção ligada (padrão desligado), prazo
--    pausado avisa; e a regra de destinatários: só o RESPONSÁVEL pela conversa; sem responsável, só o dono; atendente nunca recebe de conversa
--    que não enxerga. Membro/usuário/workspace inativos e assinaturas desativadas ficam de fora. O texto da mensagem nunca é lido nem devolvido.

create table public.push_subscriptions (
    id uuid default gen_random_uuid() not null,
    workspace_id uuid not null,
    member_id uuid not null,
    endpoint text not null,
    p256dh text not null,
    auth text not null,
    user_agent text,
    platform text not null,
    include_sla_disabled boolean default false not null,
    created_at timestamptz default now() not null,
    last_seen_at timestamptz default now() not null,
    last_error_at timestamptz,
    disabled_at timestamptz,

    constraint pk_push_subscriptions primary key (id),
    constraint uq_push_subscriptions_endpoint unique (endpoint),
    constraint fk_push_subscriptions_workspace
        foreign key (workspace_id) references public.workspaces (id) on delete restrict,
    constraint fk_push_subscriptions_member
        foreign key (workspace_id, member_id) references public.workspace_members (workspace_id, id) on delete restrict,
    constraint ck_push_subscriptions_platform check (platform in ('ios', 'android', 'desktop')),
    constraint ck_push_subscriptions_endpoint check (char_length(endpoint) between 20 and 2048 and endpoint like 'https://%'),
    constraint ck_push_subscriptions_keys check (char_length(p256dh) between 10 and 256 and char_length(auth) between 6 and 128),
    constraint ck_push_subscriptions_user_agent check (user_agent is null or char_length(user_agent) <= 200)
);

create index idx_push_subscriptions_member on public.push_subscriptions (workspace_id, member_id) where disabled_at is null;

alter table public.push_subscriptions enable row level security;
revoke all on table public.push_subscriptions from public, anon, authenticated, service_role;
grant select, insert, delete on table public.push_subscriptions to authenticated;
grant update (include_sla_disabled) on table public.push_subscriptions to authenticated;
grant select on table public.push_subscriptions to service_role;
grant update (last_seen_at, last_error_at, disabled_at) on table public.push_subscriptions to service_role;

create policy push_subscriptions_select_own on public.push_subscriptions
    for select to authenticated
    using (exists (
        select 1 from private.active_member_context() as context
        where context.member_id = push_subscriptions.member_id and context.workspace_id = push_subscriptions.workspace_id
    ));

create policy push_subscriptions_insert_own on public.push_subscriptions
    for insert to authenticated
    with check (exists (
        select 1 from private.active_member_context() as context
        where context.member_id = push_subscriptions.member_id and context.workspace_id = push_subscriptions.workspace_id
    ));

create policy push_subscriptions_update_own on public.push_subscriptions
    for update to authenticated
    using (exists (
        select 1 from private.active_member_context() as context
        where context.member_id = push_subscriptions.member_id and context.workspace_id = push_subscriptions.workspace_id
    ))
    with check (exists (
        select 1 from private.active_member_context() as context
        where context.member_id = push_subscriptions.member_id and context.workspace_id = push_subscriptions.workspace_id
    ));

create policy push_subscriptions_delete_own on public.push_subscriptions
    for delete to authenticated
    using (exists (
        select 1 from private.active_member_context() as context
        where context.member_id = push_subscriptions.member_id and context.workspace_id = push_subscriptions.workspace_id
    ));

-- ─── Registrar o aparelho da pessoa logada ─────────────────────────────────────────────────────────

create or replace function public.register_push_subscription(
    p_endpoint text,
    p_p256dh text,
    p_auth text,
    p_user_agent text,
    p_platform text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_context record;
    v_id uuid;
begin
    select context.member_id, context.workspace_id into v_context from private.active_member_context() as context limit 1;
    if v_context.member_id is null then
        return jsonb_build_object('success', false, 'status', 'forbidden');
    end if;
    if p_platform is null or p_platform not in ('ios', 'android', 'desktop') then
        return jsonb_build_object('success', false, 'status', 'invalid_platform');
    end if;
    if p_endpoint is null or p_endpoint not like 'https://%' or char_length(p_endpoint) > 2048 or char_length(p_endpoint) < 20 then
        return jsonb_build_object('success', false, 'status', 'invalid_endpoint');
    end if;

    -- O mesmo aparelho entrou com outra pessoa: a assinatura antiga deixa de valer para a pessoa anterior.
    delete from public.push_subscriptions as old
    where old.endpoint = p_endpoint and old.member_id <> v_context.member_id;

    insert into public.push_subscriptions as subscription (workspace_id, member_id, endpoint, p256dh, auth, user_agent, platform)
    values (v_context.workspace_id, v_context.member_id, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 200), p_platform)
    on conflict (endpoint) do update
       set p256dh = excluded.p256dh,
           auth = excluded.auth,
           user_agent = excluded.user_agent,
           platform = excluded.platform,
           last_seen_at = now(),
           last_error_at = null,
           disabled_at = null
    returning subscription.id into v_id;

    return jsonb_build_object('success', true, 'status', 'registered', 'subscription_id', v_id);
end;
$function$;

revoke all on function public.register_push_subscription(text, text, text, text, text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text, text) to authenticated;

-- ─── Quem recebe o aviso desta mensagem (só o servidor chama) ───────────────────────────────────────

create or replace function public.get_push_targets(p_message_id uuid)
returns table (
    subscription_id uuid,
    member_id uuid,
    endpoint text,
    p256dh text,
    auth text,
    conversation_id uuid,
    contact_name text
)
language sql
stable
security definer
set search_path = ''
as $function$
    with message as (
        select item.id, item.workspace_id, item.conversation_id
        from public.messages as item
        where item.id = p_message_id
          and item.direction = 'incoming'
          and item.origin is distinct from 'crm'
          and not item.is_history
          and item.hidden_at is null
          and item.deleted_at is null
    ),
    conversation as (
        select
            conv.id,
            conv.workspace_id,
            conv.sla_mode,
            coalesce(
                case when conv.conversation_type = 'group' then nullif(btrim(conv.subject), '') end,
                (
                    select nullif(btrim(contact.display_name), '')
                    from public.conversation_participants as participant
                    join public.contact_points as point
                      on point.workspace_id = participant.workspace_id and point.id = participant.contact_point_id
                    join public.contacts as contact
                      on contact.workspace_id = point.workspace_id and contact.id = point.contact_id
                    where participant.workspace_id = conv.workspace_id
                      and participant.conversation_id = conv.id
                      and participant.left_at is null
                    order by participant.first_seen_at, participant.id
                    limit 1
                ),
                'contato'
            ) as contact_name,
            private.is_conversation_team_visible(conv.id) as team_visible
        from public.conversations as conv
        join message on message.conversation_id = conv.id and message.workspace_id = conv.workspace_id
        where conv.archived_at is null
          and conv.operational_status is distinct from 'archived'
          and not (conv.conversation_type = 'group' and conv.visibility = 'owner_only')
          and not private.is_self_conversation(conv.id)
    ),
    assignees as (
        select assignment.member_id
        from public.conversation_assignments as assignment
        join conversation on conversation.id = assignment.conversation_id and conversation.workspace_id = assignment.workspace_id
        join public.workspace_members as assignee
          on assignee.workspace_id = assignment.workspace_id and assignee.id = assignment.member_id and assignee.status = 'active'
        where assignment.ended_at is null
    ),
    eligible as (
        select member.id as member_id, member.workspace_id, conversation.id as conversation_id,
               conversation.sla_mode, conversation.contact_name
        from conversation
        join public.workspace_members as member on member.workspace_id = conversation.workspace_id
        join public.app_users as app_user on app_user.id = member.user_id
        join public.workspaces as workspace on workspace.id = member.workspace_id
        where member.status = 'active'
          and member.role in ('owner', 'attendant')
          and app_user.status = 'active'
          and workspace.status = 'active'
          -- quem enxerga a conversa: o dono sempre; o atendente só se ela é visível à equipe
          and (member.role = 'owner' or conversation.team_visible)
          -- quem recebe: o(s) responsável(is); sem responsável, só o dono
          and (
              case
                  when exists (select 1 from assignees) then member.id in (select assignees.member_id from assignees)
                  else member.role = 'owner'
              end
          )
    )
    select
        subscription.id,
        eligible.member_id,
        subscription.endpoint,
        subscription.p256dh,
        subscription.auth,
        eligible.conversation_id,
        eligible.contact_name
    from eligible
    join public.push_subscriptions as subscription
      on subscription.workspace_id = eligible.workspace_id and subscription.member_id = eligible.member_id
    where subscription.disabled_at is null
      and (eligible.sla_mode is distinct from 'disabled' or subscription.include_sla_disabled)
    order by subscription.id;
$function$;

revoke all on function public.get_push_targets(uuid) from public, anon, authenticated;
grant execute on function public.get_push_targets(uuid) to service_role;
