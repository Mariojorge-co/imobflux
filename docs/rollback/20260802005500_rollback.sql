-- ROLLBACK da migration 20260802005500_sla_settings_and_pause.sql (manual; NÃO é uma migration).
--
-- Devolve get_conversations_inbox, get_conversation_item e get_kanban_board às definições da migration 20260802005100,
-- remove as funções novas, a tabela de limites e as colunas de prazo da conversa.
-- ATENÇÃO: apaga os limites configurados e o estado de pausa/desativação do prazo de cada conversa (as conversas voltam
-- a ter prazo normal). Eventos de auditoria "sla.*" já gravados permanecem.
-- O app desta versão usa estas funções e colunas: faça o rollback do app antes ou junto.
-- Se a migration for considerada revertida: supabase migration repair --status reverted 20260802005500
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
            case when filtered.archived_at is not null or sla_message.is_history then null else sla_message.direction end as sla_direction,
            case when filtered.archived_at is not null or sla_message.is_history then null else sla_message.occurred_at end as sla_at
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
                    'sla_at', item.sla_at
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
            case when filtered.archived_at is not null or sla_message.is_history then null else sla_message.direction end as sla_direction,
            case when filtered.archived_at is not null or sla_message.is_history then null else sla_message.occurred_at end as sla_at
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
                    'sla_at', item.sla_at
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

drop function if exists public.get_sla_conversations(integer);
drop function if exists public.set_conversation_sla_mode(uuid, text);
drop function if exists public.update_sla_settings(integer, integer, integer, integer, integer, integer, integer);
drop function if exists public.get_sla_settings();
drop function if exists private.sla_applies(uuid);
drop function if exists private.is_self_conversation(uuid);
drop table if exists public.workspace_sla_settings;
alter table public.conversations drop constraint if exists ck_conversations_sla_paused;
alter table public.conversations drop constraint if exists ck_conversations_sla_mode;
alter table public.conversations drop column if exists sla_paused_at;
alter table public.conversations drop column if exists sla_mode;

commit;
