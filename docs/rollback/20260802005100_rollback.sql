-- ROLLBACK da migration 20260802005100_conversas_pacote.sql (manual; NÃO é uma migration).
--
-- Devolve ao estado anterior (004400, 004800 e 005000): lista de conversas sem os campos de SLA novos, Kanban como era,
-- ingestão sem reabertura e histórico sem o aviso; e remove get_conversation_item. Só funções, nenhum dado é tocado.
-- Efeito de uso: conversa arquivada volta a não reabrir sozinha e o SLA volta a aparecer em conversa encerrada.
-- O app desta versão usa get_conversation_item e sla_*: faça o rollback do app (ou do deploy) antes ou junto.
-- Se a migration for considerada revertida: supabase migration repair --status reverted 20260802005100
-- Como usar (produção, só com autorização): begin; \i este-arquivo.sql; -- conferir; commit;

begin;

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
                    'assigned_to_me', item.assigned_to_me
                ) order by item.last_activity_at desc, item.conversation_id desc
            )
            from filtered as item
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

create or replace function public.ingest_whatsapp_text_message(
    p_external_account_id text,
    p_external_message_id text,
    p_remote_jid text,
    p_from_me boolean,
    p_push_name text,
    p_text_content text,
    p_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_channel_connection_id uuid;
    v_workspace_id uuid;
    v_existing_message_id uuid;
    v_normalized_phone text;
    v_contact_point_id uuid;
    v_contact_id uuid;
    v_conversation_id uuid;
    v_message_id uuid;
    v_display_name text;
    v_occurred_at timestamptz := coalesce(p_occurred_at, statement_timestamp());
    v_epoch timestamptz := least(coalesce(p_occurred_at, now()), now());
    v_is_protected boolean;
    v_only_known boolean;
begin
    if p_remote_jid is null or p_remote_jid like '%@g.us' then
        return jsonb_build_object('status', 'ignored', 'reason', 'group_requires_group_ingest');
    end if;

    -- Lista de transmissão, canal e Status nunca são conversa individual: o identificador de uma lista
    -- ('<10 a 13 dígitos>@broadcast') poderia passar por telefone na normalização abaixo.
    if p_remote_jid like '%@broadcast' or p_remote_jid like '%@newsletter' then
        return jsonb_build_object('status', 'ignored', 'reason', 'broadcast_or_channel');
    end if;

    v_normalized_phone := public.normalize_brazilian_phone(split_part(p_remote_jid, '@', 1));
    if v_normalized_phone is null then
        perform private.count_ignored_whatsapp_message(p_external_account_id, 'invalid_phone');
        return jsonb_build_object('status', 'ignored', 'reason', 'invalid_phone');
    end if;

    select connection.id, connection.workspace_id, connection.ingest_only_known_contacts
    into v_channel_connection_id, v_workspace_id, v_only_known
    from public.channel_connections as connection
    where connection.provider = 'whatsapp'
      and connection.external_account_id = p_external_account_id
      and connection.status = 'active';

    if v_channel_connection_id is null then
        raise exception 'active_whatsapp_connection_not_found' using errcode = '42704';
    end if;

    select message.id
    into v_existing_message_id
    from public.messages as message
    where message.channel_connection_id = v_channel_connection_id
      and message.external_message_id = p_external_message_id;

    if v_existing_message_id is not null then
        return jsonb_build_object('status', 'duplicate', 'message_id', v_existing_message_id);
    end if;

    select point.id, point.contact_id
    into v_contact_point_id, v_contact_id
    from public.contact_points as point
    where point.workspace_id = v_workspace_id
      and point.point_type = 'phone'
      and point.normalized_value = v_normalized_phone;

    -- Modo "só números cadastrados": o número tem de existir em Contatos (não arquivado); aceita a
    -- variante com/sem o 9º dígito dos celulares brasileiros. Desconhecido não grava nada, nem enviado por mim.
    if v_only_known then
        v_contact_point_id := null;
        v_contact_id := null;

        select point.id, point.contact_id
        into v_contact_point_id, v_contact_id
        from public.contact_points as point
        join public.contacts as contact
          on contact.workspace_id = point.workspace_id
         and contact.id = point.contact_id
        where point.workspace_id = v_workspace_id
          and point.point_type = 'phone'
          and point.normalized_value = any (
                private.phone_match_candidates(v_normalized_phone)
                || array['+' || pg_catalog.regexp_replace(pg_catalog.split_part(p_remote_jid, '@', 1), '[^0-9]', '', 'g')]
              )
          and contact.archived_at is null
        order by (point.normalized_value = v_normalized_phone) desc, point.created_at, point.id
        limit 1;

        if v_contact_point_id is null then
            perform private.count_ignored_whatsapp_message(p_external_account_id, 'unknown_contact');
            return jsonb_build_object('status', 'ignored', 'reason', 'unknown_contact');
        end if;
    end if;

    v_display_name := coalesce(
        case when not p_from_me then nullif(btrim(p_push_name), '') end,
        'Contato ' || v_normalized_phone
    );

    if v_contact_point_id is null then
        insert into public.contacts (
            workspace_id, display_name, classification, operational_status,
            registration_status, is_protected, commercial_visible_from, created_at
        )
        values (
            v_workspace_id, v_display_name, 'person', 'active',
            'provisional', false, v_epoch, v_epoch
        )
        returning id into v_contact_id;

        insert into public.contact_points (
            workspace_id, contact_id, point_type, normalized_value,
            display_value, external_display_name, operational_status,
            is_protected, commercial_visible_from, created_at
        )
        values (
            v_workspace_id, v_contact_id, 'phone', v_normalized_phone,
            v_normalized_phone,
            case when not p_from_me then nullif(btrim(p_push_name), '') end,
            'active',
            false, v_epoch, v_epoch
        )
        returning id into v_contact_point_id;
    else
        update public.contact_points
        set external_display_name = coalesce(
            case when not p_from_me then nullif(btrim(p_push_name), '') end,
            external_display_name
        )
        where id = v_contact_point_id;

        if v_contact_id is null then
            insert into public.contacts (
                workspace_id, display_name, classification, operational_status,
                registration_status, is_protected, commercial_visible_from, created_at
            )
            values (
                v_workspace_id, v_display_name, 'person', 'active',
                'provisional', false, v_epoch, v_epoch
            )
            returning id into v_contact_id;

            update public.contact_points
            set contact_id = v_contact_id,
                commercial_visible_from = greatest(v_epoch, created_at)
            where id = v_contact_point_id;
        else
            update public.contacts
            set display_name = v_display_name
            where id = v_contact_id
              and registration_status = 'provisional'
              and not p_from_me
              and nullif(btrim(p_push_name), '') is not null;
        end if;
    end if;

    select contact.is_protected
    into v_is_protected
    from public.contacts as contact
    where contact.id = v_contact_id;

    select conversation.id
    into v_conversation_id
    from public.conversations as conversation
    join public.conversation_participants as participant
      on participant.workspace_id = conversation.workspace_id
     and participant.conversation_id = conversation.id
     and participant.left_at is null
    where conversation.workspace_id = v_workspace_id
      and conversation.channel_connection_id = v_channel_connection_id
      and conversation.conversation_type = 'individual'
      and participant.contact_point_id = v_contact_point_id
    order by conversation.started_at desc, conversation.id desc
    limit 1;

    if v_conversation_id is null then
        insert into public.conversations (
            workspace_id, channel_connection_id, external_thread_id,
            conversation_type, operational_status, visibility,
            commercial_visible_from, privacy_changed_at, started_at, created_at
        )
        values (
            v_workspace_id, v_channel_connection_id, p_remote_jid,
            'individual', 'active',
            case when v_is_protected then 'owner_only' else 'commercial' end,
            case when v_is_protected then null else v_epoch end,
            v_epoch, v_epoch, v_epoch
        )
        returning id into v_conversation_id;
    end if;

    insert into public.conversation_participants (
        workspace_id, conversation_id, contact_point_id, first_seen_at, last_seen_at
    )
    values (
        v_workspace_id, v_conversation_id, v_contact_point_id,
        v_occurred_at, v_occurred_at
    )
    on conflict (conversation_id, contact_point_id)
        where contact_point_id is not null and left_at is null
    do update set
        last_seen_at = greatest(
            coalesce(public.conversation_participants.last_seen_at, public.conversation_participants.first_seen_at),
            excluded.last_seen_at
        );

    insert into public.messages (
        workspace_id, channel_connection_id, conversation_id, external_message_id,
        direction, origin, sender_contact_point_id, text_content, status,
        occurred_at, external_created_at, received_at
    )
    values (
        v_workspace_id, v_channel_connection_id, v_conversation_id,
        p_external_message_id,
        case when p_from_me then 'outgoing' else 'incoming' end,
        'whatsapp',
        case when p_from_me then null else v_contact_point_id end,
        p_text_content,
        case when p_from_me then 'sent' else 'received' end,
        v_occurred_at, v_occurred_at, statement_timestamp()
    )
    returning id into v_message_id;

    return jsonb_build_object(
        'status', 'success',
        'message_id', v_message_id,
        'conversation_id', v_conversation_id,
        'contact_id', v_contact_id,
        'from_me', p_from_me
    );
end;
$function$;

create or replace function public.ingest_whatsapp_group_text_message(
    p_external_account_id text,
    p_external_message_id text,
    p_group_jid text,
    p_sender_jid text,
    p_from_me boolean,
    p_group_subject text,
    p_push_name text,
    p_text_content text,
    p_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_channel_connection_id uuid;
    v_workspace_id uuid;
    v_existing_message_id uuid;
    v_sender_phone text;
    v_contact_point_id uuid;
    v_conversation_id uuid;
    v_message_id uuid;
    v_occurred_at timestamptz := coalesce(p_occurred_at, statement_timestamp());
    v_epoch timestamptz := least(coalesce(p_occurred_at, now()), now());
    v_ingest_groups boolean;
begin
    if p_group_jid is null or p_group_jid not like '%@g.us' then
        return jsonb_build_object('status', 'ignored', 'reason', 'invalid_group');
    end if;

    select connection.id, connection.workspace_id, connection.ingest_groups
    into v_channel_connection_id, v_workspace_id, v_ingest_groups
    from public.channel_connections as connection
    where connection.provider = 'whatsapp'
      and connection.external_account_id = p_external_account_id
      and connection.status = 'active';

    if v_channel_connection_id is null then
        raise exception 'active_whatsapp_connection_not_found' using errcode = '42704';
    end if;

    -- Grupos desligados (padrão): nada é gravado (nem conversa, nem mensagem, nem contato de participante).
    if not v_ingest_groups then
        perform private.count_ignored_whatsapp_message(p_external_account_id, 'group');
        return jsonb_build_object('status', 'ignored', 'reason', 'groups_disabled');
    end if;

    select message.id
    into v_existing_message_id
    from public.messages as message
    where message.channel_connection_id = v_channel_connection_id
      and message.external_message_id = p_external_message_id;

    if v_existing_message_id is not null then
        return jsonb_build_object('status', 'duplicate', 'message_id', v_existing_message_id);
    end if;

    if not p_from_me then
        v_sender_phone := public.normalize_brazilian_phone(split_part(p_sender_jid, '@', 1));
        if v_sender_phone is null then
            return jsonb_build_object('status', 'ignored', 'reason', 'invalid_group_sender');
        end if;

        select point.id
        into v_contact_point_id
        from public.contact_points as point
        where point.workspace_id = v_workspace_id
          and point.point_type = 'phone'
          and point.normalized_value = v_sender_phone;

        if v_contact_point_id is null then
            insert into public.contact_points (
                workspace_id, contact_id, point_type, normalized_value,
                display_value, external_display_name, operational_status,
                is_protected, commercial_visible_from, created_at
            )
            values (
                v_workspace_id, null, 'phone', v_sender_phone,
                v_sender_phone, nullif(btrim(p_push_name), ''), 'active',
                false, v_epoch, v_epoch
            )
            returning id into v_contact_point_id;
        else
            update public.contact_points
            set external_display_name = coalesce(nullif(btrim(p_push_name), ''), external_display_name)
            where id = v_contact_point_id;
        end if;
    end if;

    select conversation.id
    into v_conversation_id
    from public.conversations as conversation
    where conversation.channel_connection_id = v_channel_connection_id
      and conversation.external_thread_id = p_group_jid;

    if v_conversation_id is null then
        insert into public.conversations (
            workspace_id, channel_connection_id, external_thread_id,
            conversation_type, operational_status, visibility, subject, started_at, created_at
        )
        values (
            v_workspace_id, v_channel_connection_id, p_group_jid,
            'group', 'active', 'owner_only',
            coalesce(nullif(btrim(p_group_subject), ''), 'Grupo WhatsApp'),
            v_epoch, v_epoch
        )
        returning id into v_conversation_id;
    elsif nullif(btrim(p_group_subject), '') is not null then
        update public.conversations
        set subject = btrim(p_group_subject)
        where id = v_conversation_id
          and subject is distinct from btrim(p_group_subject);
    end if;

    if v_contact_point_id is not null then
        insert into public.conversation_participants (
            workspace_id, conversation_id, contact_point_id,
            external_display_name, first_seen_at, last_seen_at
        )
        values (
            v_workspace_id, v_conversation_id, v_contact_point_id,
            nullif(btrim(p_push_name), ''), v_occurred_at, v_occurred_at
        )
        on conflict (conversation_id, contact_point_id)
            where contact_point_id is not null and left_at is null
        do update set
            external_display_name = coalesce(excluded.external_display_name, public.conversation_participants.external_display_name),
            last_seen_at = greatest(coalesce(public.conversation_participants.last_seen_at, public.conversation_participants.first_seen_at), excluded.last_seen_at);
    end if;

    insert into public.messages (
        workspace_id, channel_connection_id, conversation_id, external_message_id,
        direction, origin, sender_contact_point_id, text_content, status,
        occurred_at, external_created_at, received_at
    )
    values (
        v_workspace_id, v_channel_connection_id, v_conversation_id,
        p_external_message_id,
        case when p_from_me then 'outgoing' else 'incoming' end,
        'whatsapp',
        case when p_from_me then null else v_contact_point_id end,
        p_text_content,
        case when p_from_me then 'sent' else 'received' end,
        v_occurred_at, v_occurred_at, statement_timestamp()
    )
    returning id into v_message_id;

    return jsonb_build_object(
        'status', 'success',
        'message_id', v_message_id,
        'conversation_id', v_conversation_id,
        'conversation_type', 'group'
    );
end;
$function$;

create or replace function public.ingest_whatsapp_history_batch(
    p_external_account_id text,
    p_messages jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_item jsonb;
    v_cutoff timestamptz;
    v_window smallint;
    v_occurred_at timestamptz;
    v_result jsonb;
    v_imported integer := 0;
    v_duplicate integer := 0;
    v_ignored integer := 0;
    v_failed integer := 0;
    v_first_error text;
begin
    if p_messages is null or jsonb_typeof(p_messages) <> 'array' then
        raise exception 'invalid_history_batch' using errcode = '22023';
    end if;
    if jsonb_array_length(p_messages) > 1000 then
        raise exception 'history_batch_too_large' using errcode = '22023';
    end if;
    select connection.history_window_days
    into v_window
    from public.channel_connections as connection
    where connection.provider = 'whatsapp'
      and connection.external_account_id = p_external_account_id
      and connection.status = 'active';
    if not found then
        raise exception 'active_whatsapp_connection_not_found' using errcode = '42704';
    end if;

    -- Janela 0: esta conexão não importa histórico; o lote é descartado inteiro.
    if v_window = 0 then
        return jsonb_build_object(
            'status', 'success', 'imported', 0, 'duplicate', 0,
            'ignored', jsonb_array_length(p_messages), 'failed', 0,
            'first_error', null, 'reason', 'history_disabled'
        );
    end if;
    v_cutoff := now() - pg_catalog.make_interval(days => v_window::integer);

    for v_item in select value from jsonb_array_elements(p_messages) loop
        begin
            v_occurred_at := (v_item->>'occurred_at')::timestamptz;
            if v_occurred_at is null
               or v_occurred_at < v_cutoff
               or v_occurred_at > now() + interval '5 minutes'
               or coalesce(v_item->>'external_message_id', '') = ''
               or coalesce(v_item->>'remote_jid', '') = ''
               or coalesce(v_item->>'text_content', '') = '' then
                v_ignored := v_ignored + 1;
                continue;
            end if;

            if (v_item->>'remote_jid') like '%@g.us' then
                v_result := public.ingest_whatsapp_group_text_message(
                    p_external_account_id,
                    v_item->>'external_message_id',
                    v_item->>'remote_jid',
                    coalesce(v_item->>'sender_jid', ''),
                    coalesce((v_item->>'from_me')::boolean, false),
                    coalesce(v_item->>'group_subject', ''),
                    coalesce(v_item->>'push_name', ''),
                    v_item->>'text_content',
                    v_occurred_at
                );
            else
                v_result := public.ingest_whatsapp_text_message(
                    p_external_account_id,
                    v_item->>'external_message_id',
                    v_item->>'remote_jid',
                    coalesce((v_item->>'from_me')::boolean, false),
                    coalesce(v_item->>'push_name', ''),
                    v_item->>'text_content',
                    v_occurred_at
                );
            end if;

            if v_result->>'status' = 'success' then
                update public.messages
                set is_history = true
                where id = (v_result->>'message_id')::uuid;
                v_imported := v_imported + 1;
            elsif v_result->>'status' = 'duplicate' then
                v_duplicate := v_duplicate + 1;
            else
                v_ignored := v_ignored + 1;
            end if;
        exception when others then
            v_failed := v_failed + 1;
            v_first_error := coalesce(v_first_error, left(sqlerrm, 200));
        end;
    end loop;

    return jsonb_build_object(
        'status', 'success',
        'imported', v_imported,
        'duplicate', v_duplicate,
        'ignored', v_ignored,
        'failed', v_failed,
        'first_error', v_first_error
    );
end;
$function$;

create or replace function public.queue_outgoing_text_message(
    p_conversation_id uuid,
    p_text_content text,
    p_client_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_context record;
    v_existing_message_id uuid;
    v_existing_status text;
    v_channel_connection_id uuid;
    v_external_thread_id text;
    v_message_id uuid;
begin
    select * into v_context
    from private.active_member_context()
    limit 1;

    if v_context.member_id is null then
        raise exception 'message_enqueue_not_authorized' using errcode = '42501';
    end if;

    if p_client_idempotency_key is null then
        raise exception 'invalid_idempotency_key' using errcode = '22023';
    end if;

    select message.id, message.status
    into v_existing_message_id, v_existing_status
    from public.messages as message
    where message.workspace_id = v_context.workspace_id
      and message.client_idempotency_key = p_client_idempotency_key;

    if v_existing_message_id is not null then
        return jsonb_build_object(
            'status', 'duplicate',
            'message_id', v_existing_message_id,
            'message_status', v_existing_status
        );
    end if;

    select conversation.channel_connection_id, conversation.external_thread_id
    into v_channel_connection_id, v_external_thread_id
    from public.conversations as conversation
    where conversation.workspace_id = v_context.workspace_id
      and conversation.id = p_conversation_id
      and conversation.operational_status in ('active', 'archived');

    if v_channel_connection_id is null then
        raise exception 'conversation_not_available' using errcode = '42704';
    end if;

    if not private.can_access_conversation(p_conversation_id) then
        raise exception 'message_enqueue_not_authorized' using errcode = '42501';
    end if;

    if nullif(btrim(p_text_content), '') is null then
        raise exception 'message_content_empty' using errcode = '22023';
    end if;

    insert into public.messages (
        workspace_id, channel_connection_id, conversation_id, direction,
        origin, status, sender_contact_point_id, internal_author_member_id,
        client_idempotency_key, text_content, occurred_at
    ) values (
        v_context.workspace_id, v_channel_connection_id, p_conversation_id,
        'outgoing', 'crm', 'queued', null, v_context.member_id,
        p_client_idempotency_key, p_text_content, statement_timestamp()
    ) returning id into v_message_id;

    return jsonb_build_object(
        'status', 'queued',
        'message_id', v_message_id,
        'conversation_id', p_conversation_id,
        'channel_connection_id', v_channel_connection_id,
        'recipient_target', v_external_thread_id
    );
exception
    when unique_violation then
        select message.id, message.status
        into v_existing_message_id, v_existing_status
        from public.messages as message
        where message.workspace_id = v_context.workspace_id
          and message.client_idempotency_key = p_client_idempotency_key;

        if v_existing_message_id is not null then
            return jsonb_build_object(
                'status', 'duplicate',
                'message_id', v_existing_message_id,
                'message_status', v_existing_status
            );
        end if;
        raise;
end;
$function$;

drop function if exists public.get_conversation_item(uuid);

commit;
