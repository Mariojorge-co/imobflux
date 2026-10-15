-- ImobFlux: prazos configuráveis, pausa de prazo por conversa e regras de grupo / conversa consigo mesmo.
--
-- 1) Limites configuráveis por workspace (workspace_sla_settings; só o OWNER altera). Sem linha = padrões, que são os
--    valores atuais de "Cliente aguardando" (10/15/30 min e 24 h) e, para "Aguardando cliente / follow-up", 6 h, 24 h e 72 h.
--    A migration NÃO insere linhas.
-- 2) Prazo por conversa: conversations.sla_mode = 'active' (padrão) | 'paused' (pausado até o cliente falar de novo)
--    | 'disabled' (desativado até reverter). Quem acessa a conversa altera (set_conversation_sla_mode, auditado).
-- 3) Uma única regra no banco decide se uma conversa tem prazo (private.sla_applies): só conversa individual, que não
--    seja a conversa da pessoa consigo mesma, e com prazo ativo (ou pausado, mas o cliente já falou depois da pausa).
--    get_conversations_inbox, get_conversation_item e get_kanban_board passam a usar essa regra (sla_direction/sla_at
--    ficam nulos quando não há prazo) e ganham campos novos (sla_applies, sla_mode, sla_paused_at, is_self).
-- 4) get_sla_conversations: base do painel de Prioridades (todas as conversas com prazo, não só as 50 mais recentes).
--
-- Retrocompatível com o app atual: só colunas com padrão, uma tabela e funções NOVAS, e três funções existentes
-- recriadas com as MESMAS assinaturas e os mesmos campos (apenas acrescentam campos e deixam sla_* nulo em grupo,
-- conversa consigo mesmo e conversa com prazo pausado/desativado).

alter table public.conversations
    add column sla_mode text not null default 'active',
    add column sla_paused_at timestamptz;

alter table public.conversations
    add constraint ck_conversations_sla_mode check (sla_mode in ('active', 'paused', 'disabled')),
    add constraint ck_conversations_sla_paused check ((sla_mode = 'paused') = (sla_paused_at is not null));

create table public.workspace_sla_settings (
    workspace_id uuid not null,
    team_green_until_minutes integer not null default 10,
    team_yellow_until_minutes integer not null default 15,
    team_orange_until_minutes integer not null default 30,
    team_red_until_minutes integer not null default 1440,
    followup_level1_minutes integer not null default 360,
    followup_level2_minutes integer not null default 1440,
    followup_level3_minutes integer not null default 4320,
    updated_by_member_id uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint pk_workspace_sla_settings primary key (workspace_id),
    constraint fk_workspace_sla_settings_workspace
        foreign key (workspace_id) references public.workspaces (id) on delete restrict,
    constraint fk_workspace_sla_settings_member
        foreign key (workspace_id, updated_by_member_id) references public.workspace_members (workspace_id, id) on delete restrict,
    constraint ck_workspace_sla_settings_team check (
        team_green_until_minutes >= 1
        and team_green_until_minutes < team_yellow_until_minutes
        and team_yellow_until_minutes < team_orange_until_minutes
        and team_orange_until_minutes < team_red_until_minutes
        and team_red_until_minutes <= 43200
    ),
    constraint ck_workspace_sla_settings_followup check (
        followup_level1_minutes >= 1
        and followup_level1_minutes < followup_level2_minutes
        and followup_level2_minutes < followup_level3_minutes
        and followup_level3_minutes <= 43200
    )
);

create trigger trg_workspace_sla_settings_set_updated_at
    before update on public.workspace_sla_settings
    for each row execute function public.set_updated_at();

alter table public.workspace_sla_settings enable row level security;
revoke all on table public.workspace_sla_settings from public, anon, authenticated, service_role;
grant select on table public.workspace_sla_settings to authenticated;

create policy workspace_sla_settings_select_member on public.workspace_sla_settings
    for select to authenticated
    using (workspace_id in (select context.workspace_id from private.active_member_context() as context));

-- ─── Regra única: a conversa tem prazo? ──────────────────────────────────────────────────────────

create or replace function private.is_self_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
    select exists (
        select 1
        from public.conversations as conversation
        join public.channel_connections as connection
          on connection.workspace_id = conversation.workspace_id
         and connection.id = conversation.channel_connection_id
        where conversation.id = p_conversation_id
          and conversation.conversation_type = 'individual'
          and nullif(connection.external_phone_normalized, '') is not null
          and (
              exists (
                  select 1
                  from public.conversation_participants as participant
                  join public.contact_points as point
                    on point.workspace_id = participant.workspace_id
                   and point.id = participant.contact_point_id
                  where participant.workspace_id = conversation.workspace_id
                    and participant.conversation_id = conversation.id
                    and point.normalized_value = any (
                        private.phone_match_candidates(connection.external_phone_normalized)
                        || array[connection.external_phone_normalized]
                    )
              )
              or pg_catalog.regexp_replace(pg_catalog.split_part(conversation.external_thread_id, '@', 1), '[^0-9]', '', 'g')
                 = pg_catalog.regexp_replace(connection.external_phone_normalized, '[^0-9]', '', 'g')
          )
    );
$function$;

create or replace function private.sla_applies(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
    select exists (
        select 1
        from public.conversations as conversation
        where conversation.id = p_conversation_id
          and conversation.conversation_type = 'individual'
          and not private.is_self_conversation(conversation.id)
          and (
              conversation.sla_mode = 'active'
              or (
                  conversation.sla_mode = 'paused'
                  and exists (
                      select 1
                      from public.messages as message
                      where message.workspace_id = conversation.workspace_id
                        and message.conversation_id = conversation.id
                        and message.direction = 'incoming'
                        and not message.is_history
                        and message.status is distinct from 'failed'
                        and message.occurred_at > conversation.sla_paused_at
                  )
              )
          )
    );
$function$;

alter function private.is_self_conversation(uuid) owner to postgres;
alter function private.sla_applies(uuid) owner to postgres;
revoke all on function private.is_self_conversation(uuid) from public, anon, authenticated, service_role;
revoke all on function private.sla_applies(uuid) from public, anon, authenticated, service_role;
grant execute on function private.is_self_conversation(uuid) to authenticated;
grant execute on function private.sla_applies(uuid) to authenticated;

-- ─── Limites ─────────────────────────────────────────────────────────────────────────────────────

create or replace function public.get_sla_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
    v_context record;
    v_row public.workspace_sla_settings;
begin
    select context.* into v_context from private.active_member_context() as context limit 1;
    if v_context.member_id is null then
        raise exception 'sla_not_authorized' using errcode = '42501';
    end if;

    select settings.* into v_row
    from public.workspace_sla_settings as settings
    where settings.workspace_id = v_context.workspace_id;

    -- Sem linha: os padrões da tabela (nada é gravado ao ler).
    return jsonb_build_object(
        'team_green_until_minutes', coalesce(v_row.team_green_until_minutes, 10),
        'team_yellow_until_minutes', coalesce(v_row.team_yellow_until_minutes, 15),
        'team_orange_until_minutes', coalesce(v_row.team_orange_until_minutes, 30),
        'team_red_until_minutes', coalesce(v_row.team_red_until_minutes, 1440),
        'followup_level1_minutes', coalesce(v_row.followup_level1_minutes, 360),
        'followup_level2_minutes', coalesce(v_row.followup_level2_minutes, 1440),
        'followup_level3_minutes', coalesce(v_row.followup_level3_minutes, 4320),
        'is_default', v_row.workspace_id is null
    );
end;
$function$;

create or replace function public.update_sla_settings(
    p_team_green integer,
    p_team_yellow integer,
    p_team_orange integer,
    p_team_red integer,
    p_followup1 integer,
    p_followup2 integer,
    p_followup3 integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_context record;
    v_previous jsonb;
    v_next jsonb;
    v_now timestamptz := pg_catalog.clock_timestamp();
begin
    select context.* into v_context from private.active_member_context() as context limit 1;
    if v_context.member_id is null or v_context.member_role <> 'owner' then
        raise exception 'sla_not_authorized' using errcode = '42501';
    end if;

    if p_team_green is null or p_team_yellow is null or p_team_orange is null or p_team_red is null
       or p_followup1 is null or p_followup2 is null or p_followup3 is null
       or not (p_team_green >= 1 and p_team_green < p_team_yellow and p_team_yellow < p_team_orange
               and p_team_orange < p_team_red and p_team_red <= 43200)
       or not (p_followup1 >= 1 and p_followup1 < p_followup2 and p_followup2 < p_followup3 and p_followup3 <= 43200) then
        raise exception 'sla_limits_invalid' using errcode = '22023';
    end if;

    v_previous := public.get_sla_settings();

    insert into public.workspace_sla_settings (
        workspace_id, team_green_until_minutes, team_yellow_until_minutes, team_orange_until_minutes, team_red_until_minutes,
        followup_level1_minutes, followup_level2_minutes, followup_level3_minutes, updated_by_member_id
    ) values (
        v_context.workspace_id, p_team_green, p_team_yellow, p_team_orange, p_team_red,
        p_followup1, p_followup2, p_followup3, v_context.member_id
    )
    on conflict (workspace_id) do update
    set team_green_until_minutes = excluded.team_green_until_minutes,
        team_yellow_until_minutes = excluded.team_yellow_until_minutes,
        team_orange_until_minutes = excluded.team_orange_until_minutes,
        team_red_until_minutes = excluded.team_red_until_minutes,
        followup_level1_minutes = excluded.followup_level1_minutes,
        followup_level2_minutes = excluded.followup_level2_minutes,
        followup_level3_minutes = excluded.followup_level3_minutes,
        updated_by_member_id = excluded.updated_by_member_id;

    v_next := public.get_sla_settings();

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type,
        target_id, result, metadata, occurred_at, recorded_at
    ) values (
        v_context.workspace_id, 'member', v_context.member_id, 'sla.limits_changed',
        'workspace', v_context.workspace_id, 'success',
        pg_catalog.jsonb_build_object('previous', v_previous - 'is_default', 'current', v_next - 'is_default'), v_now, v_now
    );

    return v_next;
end;
$function$;

-- ─── Prazo por conversa ──────────────────────────────────────────────────────────────────────────

create or replace function public.set_conversation_sla_mode(
    p_conversation_id uuid,
    p_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_context record;
    v_conversation public.conversations;
    v_now timestamptz := pg_catalog.clock_timestamp();
begin
    select context.* into v_context from private.active_member_context() as context limit 1;
    if v_context.member_id is null then
        raise exception 'sla_not_authorized' using errcode = '42501';
    end if;
    if p_mode is null or p_mode not in ('active', 'paused', 'disabled') then
        raise exception 'sla_mode_invalid' using errcode = '22023';
    end if;

    select conversation.* into v_conversation
    from public.conversations as conversation
    where conversation.id = p_conversation_id
      and conversation.workspace_id = v_context.workspace_id
    for update;

    if v_conversation.id is null then
        raise exception 'conversation_not_available' using errcode = '42704';
    end if;
    if not private.can_access_conversation(p_conversation_id) then
        raise exception 'sla_not_authorized' using errcode = '42501';
    end if;
    -- Grupo e conversa consigo mesmo nunca têm prazo: não há o que pausar.
    if v_conversation.conversation_type <> 'individual' or private.is_self_conversation(p_conversation_id) then
        raise exception 'sla_not_applicable' using errcode = '22023';
    end if;

    if v_conversation.sla_mode = p_mode then
        return jsonb_build_object('status', 'unchanged', 'sla_mode', v_conversation.sla_mode, 'sla_paused_at', v_conversation.sla_paused_at);
    end if;

    update public.conversations
    set sla_mode = p_mode,
        sla_paused_at = case when p_mode = 'paused' then v_now else null end
    where id = v_conversation.id
    returning * into v_conversation;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type,
        target_id, result, metadata, occurred_at, recorded_at
    ) values (
        v_context.workspace_id, 'member', v_context.member_id,
        case p_mode when 'paused' then 'sla.conversation_paused' when 'disabled' then 'sla.conversation_disabled' else 'sla.conversation_enabled' end,
        'conversation', v_conversation.id, 'success', '{}'::jsonb, v_now, v_now
    );

    return jsonb_build_object('status', 'success', 'sla_mode', v_conversation.sla_mode, 'sla_paused_at', v_conversation.sla_paused_at,
                              'sla_applies', private.sla_applies(v_conversation.id));
end;
$function$;

-- ─── Painel de Prioridades: todas as conversas com prazo ─────────────────────────────────────────

create or replace function public.get_sla_conversations(p_limit integer default 500)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
    with caller as (
        select context.member_id, context.workspace_id
        from private.active_member_context() as context
    ),
    base as (
        select
            conversation.id as conversation_id,
            conversation.started_at,
            individual_contact.id as contact_id,
            individual_contact.display_name as participant_name,
            sla_message.direction as sla_direction,
            sla_message.occurred_at as sla_at
        from public.conversations as conversation
        join caller on caller.workspace_id = conversation.workspace_id
        left join lateral (
            select participant.contact_point_id
            from public.conversation_participants as participant
            where participant.workspace_id = conversation.workspace_id
              and participant.conversation_id = conversation.id
              and participant.left_at is null
            order by participant.first_seen_at, participant.id
            limit 1
        ) as primary_participant on true
        left join public.contact_points as point
          on point.workspace_id = conversation.workspace_id
         and point.id = primary_participant.contact_point_id
        left join public.contacts as individual_contact
          on individual_contact.workspace_id = point.workspace_id
         and individual_contact.id = point.contact_id
        join lateral (
            select message.direction, message.occurred_at, message.is_history
            from public.messages as message
            where message.workspace_id = conversation.workspace_id
              and message.conversation_id = conversation.id
              and message.status is distinct from 'failed'
            order by message.occurred_at desc, message.id desc
            limit 1
        ) as sla_message on not sla_message.is_history
        where conversation.conversation_type = 'individual'
          and conversation.archived_at is null
          and conversation.operational_status = 'active'
          and private.sla_applies(conversation.id)
    )
    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'conversation_id', base.conversation_id,
                'contact_id', base.contact_id,
                'participant_name', base.participant_name,
                'started_at', base.started_at,
                'sla_direction', base.sla_direction,
                'sla_at', base.sla_at
            ) order by base.sla_at asc, base.conversation_id asc
        ),
        '[]'::jsonb
    )
    from (
        select * from base
        order by base.sla_at asc, base.conversation_id asc
        limit greatest(1, least(coalesce(p_limit, 500), 1000))
    ) as base;
$function$;


-- ─── Funções existentes recriadas (mesmas assinaturas; só acrescentam campos e aplicam a regra única) ──

create or replace function public.get_conversations_inbox(
    p_view text default 'all',
    p_search text default null,
    p_cursor_ts timestamptz default null,
    p_cursor_id uuid default null,
    p_limit integer default 20
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
    with caller as (
        select context.member_id, context.workspace_id, context.member_role
        from private.active_member_context() as context
    ),
    authorized_conversations as (
        select conversation.*
        from public.conversations as conversation
        join caller on caller.workspace_id = conversation.workspace_id
    ),
    projected as (
        select
            conversation.workspace_id as workspace_id,
            conversation.id as conversation_id,
            conversation.conversation_type,
            conversation.visibility,
            conversation.operational_status,
            conversation.archived_at,
            conversation.started_at,
            case
                when conversation.conversation_type = 'group'
                    then coalesce(conversation.subject, 'Grupo WhatsApp')
                else individual_contact.display_name
            end as participant_name,
            case when conversation.conversation_type = 'individual' then point.display_value end as participant_phone,
            case when conversation.conversation_type = 'individual' then individual_contact.id end as contact_id,
            case when conversation.conversation_type = 'individual' and point.external_avatar_url is not null
                 then '/api/contact-avatar/' || point.id::text end as avatar_url,
            last_message.text_content as last_msg_text,
            case when last_message.is_history then null else last_message.direction end as last_msg_direction,
            last_message.occurred_at as last_msg_occurred_at,
            case
                when last_message.internal_author_member_id is not null then author_user.display_name
                when conversation.conversation_type = 'group' then group_sender.external_display_name
                else null
            end as last_msg_author_name,
            coalesce(
                last_message.occurred_at,
                case when caller.member_role = 'attendant' then conversation.commercial_visible_from end,
                conversation.started_at
            ) as last_activity_at,
            (
                coalesce(read_state.is_unread, false)
                or exists (
                    select 1
                    from public.messages as unread_message
                    where unread_message.workspace_id = conversation.workspace_id
                      and unread_message.conversation_id = conversation.id
                      and unread_message.direction = 'incoming'
                      and not unread_message.is_history
                      and unread_message.occurred_at > coalesce(read_state.last_read_at, '-infinity'::timestamptz)
                )
            ) as is_unread,
            assignment_info.assignees,
            assignment_info.assigned_to_me
        from authorized_conversations as conversation
        join caller on caller.workspace_id = conversation.workspace_id
        left join lateral (
            select
                coalesce(
                    jsonb_agg(
                        jsonb_build_object('member_id', assignment.member_id, 'display_name', private.member_display_name(assignment.workspace_id, assignment.member_id))
                        order by assignment.assigned_at, assignment.id
                    ),
                    '[]'::jsonb
                ) as assignees,
                coalesce(bool_or(assignment.member_id = caller.member_id), false) as assigned_to_me
            from public.conversation_assignments as assignment
            where assignment.workspace_id = conversation.workspace_id
              and assignment.conversation_id = conversation.id
              and assignment.ended_at is null
        ) as assignment_info on true
        left join lateral (
            select participant.contact_point_id
            from public.conversation_participants as participant
            where participant.workspace_id = conversation.workspace_id
              and participant.conversation_id = conversation.id
              and participant.left_at is null
            order by participant.first_seen_at, participant.id
            limit 1
        ) as primary_participant on true
        left join public.contact_points as point
          on point.workspace_id = conversation.workspace_id
         and point.id = primary_participant.contact_point_id
        left join public.contacts as individual_contact
          on individual_contact.workspace_id = point.workspace_id
         and individual_contact.id = point.contact_id
        left join lateral (
            select message.*
            from public.messages as message
            where message.workspace_id = conversation.workspace_id
              and message.conversation_id = conversation.id
            order by message.occurred_at desc, message.id desc
            limit 1
        ) as last_message on true
        left join public.workspace_members as author_member
          on author_member.workspace_id = last_message.workspace_id
         and author_member.id = last_message.internal_author_member_id
        left join public.app_users as author_user
          on author_user.id = author_member.user_id
        left join public.conversation_participants as group_sender
          on group_sender.workspace_id = last_message.workspace_id
         and group_sender.conversation_id = last_message.conversation_id
         and group_sender.contact_point_id = last_message.sender_contact_point_id
         and group_sender.left_at is null
        left join public.conversation_read_states as read_state
          on read_state.workspace_id = conversation.workspace_id
         and read_state.conversation_id = conversation.id
         and read_state.member_id = caller.member_id
    ),
    searched as (
        select *
        from projected
        where p_search is null
           or btrim(p_search) = ''
           or participant_name ilike '%' || btrim(p_search) || '%'
           or participant_phone ilike '%' || btrim(p_search) || '%'
    ),
    filtered as (
        select *
        from searched
        where case coalesce(p_view, 'all')
            when 'archived' then archived_at is not null
            when 'unread' then archived_at is null and is_unread
            when 'groups' then archived_at is null and conversation_type = 'group'
            when 'mine' then archived_at is null and assigned_to_me
            else archived_at is null
        end
          and (
              p_cursor_ts is null
              or (last_activity_at, conversation_id) < (p_cursor_ts, p_cursor_id)
          )
        order by last_activity_at desc, conversation_id desc
        limit greatest(1, least(coalesce(p_limit, 20), 100))
    ),
    with_sla as (
        select
            filtered.*,
            case when filtered.archived_at is not null or sla_message.is_history or not private.sla_applies(filtered.conversation_id) then null else sla_message.direction end as sla_direction,
            case when filtered.archived_at is not null or sla_message.is_history or not private.sla_applies(filtered.conversation_id) then null else sla_message.occurred_at end as sla_at,
            private.sla_applies(filtered.conversation_id) as sla_applies,
            private.is_self_conversation(filtered.conversation_id) as is_self,
            sla_state.sla_mode as sla_mode,
            sla_state.sla_paused_at as sla_paused_at
        from filtered
        left join lateral (
            select message.direction, message.occurred_at, message.is_history
            from public.messages as message
            where message.workspace_id = filtered.workspace_id
              and message.conversation_id = filtered.conversation_id
              and message.status is distinct from 'failed'
            order by message.occurred_at desc, message.id desc
            limit 1
        ) as sla_message on true
        left join lateral (
            select state.sla_mode, state.sla_paused_at
            from public.conversations as state
            where state.id = filtered.conversation_id
        ) as sla_state on true
        order by filtered.last_activity_at desc, filtered.conversation_id desc
    ),
    counts as (
        select
            count(*) filter (where archived_at is null) as all_count,
            count(*) filter (where archived_at is null and is_unread) as unread_count,
            count(*) filter (where archived_at is null and conversation_type = 'group') as group_count,
            count(*) filter (where archived_at is null and assigned_to_me) as mine_count,
            count(*) filter (where archived_at is not null) as archived_count,
            count(*) filter (where archived_at is not null and is_unread) as archived_unread_count
        from projected
    )
    select jsonb_build_object(
        'items', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'conversation_id', item.conversation_id,
                    'conversation_type', item.conversation_type,
                    'visibility', item.visibility,
                    'operational_status', item.operational_status,
                    'archived_at', item.archived_at,
                    'started_at', item.started_at,
                    'last_activity_at', item.last_activity_at,
                    'last_msg_text', item.last_msg_text,
                    'last_msg_direction', item.last_msg_direction,
                    'last_msg_occurred_at', item.last_msg_occurred_at,
                    'last_msg_author_name', item.last_msg_author_name,
                    'participant_name', item.participant_name,
                    'participant_phone', item.participant_phone,
                    'contact_id', item.contact_id,
                    'avatar_url', item.avatar_url,
                    'is_unread', item.is_unread,
                    'assignees', item.assignees,
                    'assigned_to_me', item.assigned_to_me,
                    'sla_direction', item.sla_direction,
                    'sla_at', item.sla_at,
                    'sla_applies', item.sla_applies,
                    'sla_mode', item.sla_mode,
                    'sla_paused_at', item.sla_paused_at,
                    'is_self', item.is_self
                ) order by item.last_activity_at desc, item.conversation_id desc
            )
            from with_sla as item
        ), '[]'::jsonb),
        'counts', (
            select jsonb_build_object(
                'all', counts.all_count,
                'unread', counts.unread_count,
                'groups', counts.group_count,
                'mine', counts.mine_count,
                'archived', counts.archived_count,
                'archived_unread', counts.archived_unread_count
            )
            from counts
        )
    );
$function$;

create or replace function public.get_conversation_item(
    p_conversation_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
    with caller as (
        select context.member_id, context.workspace_id, context.member_role
        from private.active_member_context() as context
    ),
    authorized_conversations as (
        select conversation.*
        from public.conversations as conversation
        join caller on caller.workspace_id = conversation.workspace_id
        where conversation.id = p_conversation_id
    ),
    projected as (
        select
            conversation.workspace_id as workspace_id,
            conversation.id as conversation_id,
            conversation.conversation_type,
            conversation.visibility,
            conversation.operational_status,
            conversation.archived_at,
            conversation.started_at,
            case
                when conversation.conversation_type = 'group'
                    then coalesce(conversation.subject, 'Grupo WhatsApp')
                else individual_contact.display_name
            end as participant_name,
            case when conversation.conversation_type = 'individual' then point.display_value end as participant_phone,
            case when conversation.conversation_type = 'individual' then individual_contact.id end as contact_id,
            case when conversation.conversation_type = 'individual' and point.external_avatar_url is not null
                 then '/api/contact-avatar/' || point.id::text end as avatar_url,
            last_message.text_content as last_msg_text,
            case when last_message.is_history then null else last_message.direction end as last_msg_direction,
            last_message.occurred_at as last_msg_occurred_at,
            case
                when last_message.internal_author_member_id is not null then author_user.display_name
                when conversation.conversation_type = 'group' then group_sender.external_display_name
                else null
            end as last_msg_author_name,
            coalesce(
                last_message.occurred_at,
                case when caller.member_role = 'attendant' then conversation.commercial_visible_from end,
                conversation.started_at
            ) as last_activity_at,
            (
                coalesce(read_state.is_unread, false)
                or exists (
                    select 1
                    from public.messages as unread_message
                    where unread_message.workspace_id = conversation.workspace_id
                      and unread_message.conversation_id = conversation.id
                      and unread_message.direction = 'incoming'
                      and not unread_message.is_history
                      and unread_message.occurred_at > coalesce(read_state.last_read_at, '-infinity'::timestamptz)
                )
            ) as is_unread,
            assignment_info.assignees,
            assignment_info.assigned_to_me
        from authorized_conversations as conversation
        join caller on caller.workspace_id = conversation.workspace_id
        left join lateral (
            select
                coalesce(
                    jsonb_agg(
                        jsonb_build_object('member_id', assignment.member_id, 'display_name', private.member_display_name(assignment.workspace_id, assignment.member_id))
                        order by assignment.assigned_at, assignment.id
                    ),
                    '[]'::jsonb
                ) as assignees,
                coalesce(bool_or(assignment.member_id = caller.member_id), false) as assigned_to_me
            from public.conversation_assignments as assignment
            where assignment.workspace_id = conversation.workspace_id
              and assignment.conversation_id = conversation.id
              and assignment.ended_at is null
        ) as assignment_info on true
        left join lateral (
            select participant.contact_point_id
            from public.conversation_participants as participant
            where participant.workspace_id = conversation.workspace_id
              and participant.conversation_id = conversation.id
              and participant.left_at is null
            order by participant.first_seen_at, participant.id
            limit 1
        ) as primary_participant on true
        left join public.contact_points as point
          on point.workspace_id = conversation.workspace_id
         and point.id = primary_participant.contact_point_id
        left join public.contacts as individual_contact
          on individual_contact.workspace_id = point.workspace_id
         and individual_contact.id = point.contact_id
        left join lateral (
            select message.*
            from public.messages as message
            where message.workspace_id = conversation.workspace_id
              and message.conversation_id = conversation.id
            order by message.occurred_at desc, message.id desc
            limit 1
        ) as last_message on true
        left join public.workspace_members as author_member
          on author_member.workspace_id = last_message.workspace_id
         and author_member.id = last_message.internal_author_member_id
        left join public.app_users as author_user
          on author_user.id = author_member.user_id
        left join public.conversation_participants as group_sender
          on group_sender.workspace_id = last_message.workspace_id
         and group_sender.conversation_id = last_message.conversation_id
         and group_sender.contact_point_id = last_message.sender_contact_point_id
         and group_sender.left_at is null
        left join public.conversation_read_states as read_state
          on read_state.workspace_id = conversation.workspace_id
         and read_state.conversation_id = conversation.id
         and read_state.member_id = caller.member_id
    ),
    filtered as (
        select * from projected
    ),
    with_sla as (
        select
            filtered.*,
            case when filtered.archived_at is not null or sla_message.is_history or not private.sla_applies(filtered.conversation_id) then null else sla_message.direction end as sla_direction,
            case when filtered.archived_at is not null or sla_message.is_history or not private.sla_applies(filtered.conversation_id) then null else sla_message.occurred_at end as sla_at,
            private.sla_applies(filtered.conversation_id) as sla_applies,
            private.is_self_conversation(filtered.conversation_id) as is_self,
            sla_state.sla_mode as sla_mode,
            sla_state.sla_paused_at as sla_paused_at
        from filtered
        left join lateral (
            select message.direction, message.occurred_at, message.is_history
            from public.messages as message
            where message.workspace_id = filtered.workspace_id
              and message.conversation_id = filtered.conversation_id
              and message.status is distinct from 'failed'
            order by message.occurred_at desc, message.id desc
            limit 1
        ) as sla_message on true
        left join lateral (
            select state.sla_mode, state.sla_paused_at
            from public.conversations as state
            where state.id = filtered.conversation_id
        ) as sla_state on true
        order by filtered.last_activity_at desc, filtered.conversation_id desc
    )
    select jsonb_build_object(
                    'conversation_id', item.conversation_id,
                    'workspace_id', item.workspace_id,
                    'conversation_type', item.conversation_type,
                    'visibility', item.visibility,
                    'operational_status', item.operational_status,
                    'archived_at', item.archived_at,
                    'started_at', item.started_at,
                    'last_activity_at', item.last_activity_at,
                    'last_msg_text', item.last_msg_text,
                    'last_msg_direction', item.last_msg_direction,
                    'last_msg_occurred_at', item.last_msg_occurred_at,
                    'last_msg_author_name', item.last_msg_author_name,
                    'participant_name', item.participant_name,
                    'participant_phone', item.participant_phone,
                    'contact_id', item.contact_id,
                    'avatar_url', item.avatar_url,
                    'is_unread', item.is_unread,
                    'assignees', item.assignees,
                    'assigned_to_me', item.assigned_to_me,
                    'sla_direction', item.sla_direction,
                    'sla_at', item.sla_at,
                    'sla_applies', item.sla_applies,
                    'sla_mode', item.sla_mode,
                    'sla_paused_at', item.sla_paused_at,
                    'is_self', item.is_self
                )
    from with_sla as item
    limit 1;
$function$;

create or replace function public.get_kanban_board(
    p_limit_per_stage integer default 50
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
    v_limit integer;
    v_board jsonb;
begin
    v_limit := greatest(1, least(coalesce(p_limit_per_stage, 50), 200));

    with active_stages as (
        select s.id as stage_id, s.name, s.position, s.commercial_meaning
        from public.pipeline_stages s
        where s.is_active = true
        order by s.position asc
    ),
    stage_opp_counts as (
        select o.current_stage_id, count(*)::integer as total_count
        from public.opportunities o
        where o.status = 'open' and o.archived_at is null
        group by o.current_stage_id
    ),
    ranked_opps as (
        select
            o.id as opportunity_id, o.current_stage_id, o.title, o.description,
            o.origin, o.property_summary, o.operation_type,
            o.property_type_preference, o.city_region_preference,
            o.value_range_preference, o.created_at, o.updated_at,
            o.sort_order, c.id as contact_id, c.display_name as contact_name,
            c.classification as contact_classification,
            o.responsible_member_id as responsible_member_id,
            private.member_display_name(o.workspace_id, o.responsible_member_id) as responsible_name,
            (oc_link.conversation_id is not null) as has_linked_conversation,
            oc_link.conversation_id as linked_conversation_id,
            lm.direction as last_msg_direction,
            lm.occurred_at as last_msg_at,
            row_number() over (
                partition by o.current_stage_id
                order by o.sort_order asc, o.id asc
            ) as row_num
        from public.opportunities o
        join public.contacts c on c.id = o.contact_id and c.workspace_id = o.workspace_id
        left join lateral (
            select oc.conversation_id
            from public.opportunity_conversations oc
            where oc.opportunity_id = o.id and oc.workspace_id = o.workspace_id and oc.unlinked_at is null
            order by oc.linked_at desc
            limit 1
        ) oc_link on true
        left join lateral (
            select msg.direction, msg.occurred_at
            from public.messages msg
            where msg.conversation_id = oc_link.conversation_id
              and msg.workspace_id = o.workspace_id
              and not msg.is_history
              and msg.status is distinct from 'failed'
              and not exists (
                  select 1 from public.conversations as closed_conversation
                  where closed_conversation.id = oc_link.conversation_id
                    and closed_conversation.workspace_id = o.workspace_id
                    and closed_conversation.archived_at is not null
              )
              and private.sla_applies(oc_link.conversation_id)
            order by msg.occurred_at desc, msg.id desc
            limit 1
        ) lm on oc_link.conversation_id is not null
        where o.status = 'open' and o.archived_at is null
    ),
    stage_cards as (
        select ro.current_stage_id,
            jsonb_agg(jsonb_build_object(
                'id', ro.opportunity_id, 'title', ro.title, 'description', ro.description,
                'origin', ro.origin, 'property_summary', ro.property_summary,
                'operation_type', ro.operation_type,
                'property_type_preference', ro.property_type_preference,
                'city_region_preference', ro.city_region_preference,
                'value_range_preference', ro.value_range_preference,
                'created_at', ro.created_at, 'updated_at', ro.updated_at,
                'contact_id', ro.contact_id, 'contact_name', ro.contact_name,
                'contact_classification', ro.contact_classification,
                'responsible_member_id', ro.responsible_member_id,
                'responsible_name', ro.responsible_name,
                'has_linked_conversation', ro.has_linked_conversation,
                'linked_conversation_id', ro.linked_conversation_id,
                'last_msg_direction', ro.last_msg_direction,
                'last_msg_at', ro.last_msg_at
            ) order by ro.sort_order asc, ro.opportunity_id asc) as cards
        from ranked_opps ro
        where ro.row_num <= v_limit
        group by ro.current_stage_id
    )
    select jsonb_agg(jsonb_build_object(
        'id', st.stage_id, 'name', st.name, 'position', st.position,
        'commercial_meaning', st.commercial_meaning,
        'total_count', coalesce(cnt.total_count, 0),
        'has_more', (coalesce(cnt.total_count, 0) > v_limit),
        'cards', coalesce(sc.cards, '[]'::jsonb)
    ) order by st.position asc)
    into v_board
    from active_stages st
    left join stage_opp_counts cnt on cnt.current_stage_id = st.stage_id
    left join stage_cards sc on sc.current_stage_id = st.stage_id;

    return coalesce(v_board, '[]'::jsonb);
end;
$function$;

-- ─── Permissões das funções novas ────────────────────────────────────────────────────────────────

alter function public.get_sla_settings() owner to postgres;
alter function public.update_sla_settings(integer, integer, integer, integer, integer, integer, integer) owner to postgres;
alter function public.set_conversation_sla_mode(uuid, text) owner to postgres;
alter function public.get_sla_conversations(integer) owner to postgres;

revoke all on function public.get_sla_settings() from public, anon, authenticated, service_role;
revoke all on function public.update_sla_settings(integer, integer, integer, integer, integer, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.set_conversation_sla_mode(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.get_sla_conversations(integer) from public, anon, authenticated, service_role;

grant execute on function public.get_sla_settings() to authenticated;
grant execute on function public.update_sla_settings(integer, integer, integer, integer, integer, integer, integer) to authenticated;
grant execute on function public.set_conversation_sla_mode(uuid, text) to authenticated;
grant execute on function public.get_sla_conversations(integer) to authenticated;
