-- ImobFlux: leitura de mensagens e da lista de conversas com as novidades do pacote de mensagens.
--
--   * get_conversation_messages: devolve citação (reply_*), "editada", "apagada" (sem texto nem arquivos), "encaminhada",
--     reações, o autor interno e se a mensagem tem id do WhatsApp; NÃO devolve as mensagens escondidas ("apagar para mim").
--   * get_conversations_inbox / get_conversation_item: a última mensagem da prévia ignora as escondidas e mostra
--     "Mensagem apagada" quando foi apagada para todos; a lista traz primeiro as conversas FIXADAS de quem pede
--     (fixação pessoal, só na primeira página) e o campo is_pinned.
--
-- Retrocompatível: mesmas assinaturas e todos os campos antigos; só acrescenta campos e esconde o que foi escondido. O prazo
-- (sla_*) continua usando a última mensagem válida, escondida ou não (esconder/apagar não muda o prazo).

create or replace function public.get_conversation_messages(
    p_conversation_id uuid,
    p_cursor_occurred_at timestamptz default null,
    p_cursor_id uuid default null,
    p_limit integer default 50
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
    with bounded as (
        select greatest(1, least(coalesce(p_limit, 50), 100)) as page_size
    ),
    page as (
        select
            message.id,
            message.direction,
            message.origin,
            message.status,
            case when message.deleted_at is not null then null else message.text_content end as text_content,
            message.occurred_at,
            message.is_history,
            message.internal_author_member_id,
            message.reply_to_message_id,
            message.reply_snapshot,
            message.edited_at,
            message.deleted_at,
            message.deleted_source,
            message.forwarded,
            (message.external_message_id is not null) as has_external_id,
            coalesce((
                select jsonb_agg(
                    jsonb_build_object(
                        'emoji', reaction.emoji,
                        'by', case when reaction.member_id is not null then 'member' when reaction.contact_point_id is not null then 'contact' else 'account' end,
                        'mine', reaction.member_id is not null and reaction.member_id = (select context.member_id from private.active_member_context() as context limit 1),
                        'name', case
                            when reaction.member_id is not null then private.member_display_name(reaction.workspace_id, reaction.member_id)
                            when reaction.contact_point_id is not null then (
                                select contact.display_name
                                from public.contact_points as point
                                join public.contacts as contact on contact.workspace_id = point.workspace_id and contact.id = point.contact_id
                                where point.workspace_id = reaction.workspace_id and point.id = reaction.contact_point_id)
                            else 'Celular da conta'
                        end
                    ) order by reaction.created_at, reaction.id
                )
                from public.message_reactions as reaction
                where reaction.message_id = message.id
            ), '[]'::jsonb) as reactions,
            author_user.display_name as internal_author_name,
            sender.external_display_name as sender_display_name,
            (message.deleted_at is null and exists (
                select 1
                from public.attachments as attachment
                where attachment.message_id = message.id
            )) as has_attachments,
            case when message.deleted_at is not null then '[]'::jsonb else coalesce((
                select jsonb_agg(
                    jsonb_build_object(
                        'id', attachment.id,
                        'file_name', attachment.original_file_name,
                        'mime_type', attachment.mime_type,
                        'size_bytes', attachment.size_bytes,
                        'status', attachment.status,
                        'created_at', attachment.created_at
                    ) order by attachment.created_at, attachment.id
                )
                from public.attachments as attachment
                where attachment.message_id = message.id
            ), '[]'::jsonb) end as attachments
        from public.messages as message
        left join public.workspace_members as author_member
          on author_member.workspace_id = message.workspace_id
         and author_member.id = message.internal_author_member_id
        left join public.app_users as author_user
          on author_user.id = author_member.user_id
        left join public.conversation_participants as sender
          on sender.workspace_id = message.workspace_id
         and sender.conversation_id = message.conversation_id
         and sender.contact_point_id = message.sender_contact_point_id
         and sender.left_at is null
        where message.conversation_id = p_conversation_id
          and message.hidden_at is null
          and (
              p_cursor_occurred_at is null
              or (message.occurred_at, message.id) < (p_cursor_occurred_at, p_cursor_id)
          )
        order by message.occurred_at desc, message.id desc
        limit (select page_size + 1 from bounded)
    ),
    visible_page as (
        select *
        from page
        order by occurred_at desc, id desc
        limit (select page_size from bounded)
    )
    select jsonb_build_object(
        'messages', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'id', item.id,
                    'direction', item.direction,
                    'origin', item.origin,
                    'status', item.status,
                    'text_content', item.text_content,
                    'occurred_at', item.occurred_at,
                    'is_history', item.is_history,
                    'internal_author_name', item.internal_author_name,
                    'sender_display_name', item.sender_display_name,
                    'has_attachments', item.has_attachments,
                    'attachments', item.attachments,
                    'internal_author_member_id', item.internal_author_member_id,
                    'reply_to_message_id', item.reply_to_message_id,
                    'reply_snapshot', item.reply_snapshot,
                    'edited_at', item.edited_at,
                    'deleted_at', item.deleted_at,
                    'deleted_source', item.deleted_source,
                    'forwarded', item.forwarded,
                    'has_external_id', item.has_external_id,
                    'reactions', item.reactions
                ) order by item.occurred_at, item.id
            )
            from visible_page as item
        ), '[]'::jsonb),
        'has_more', (select count(*) > (select page_size from bounded) from page)
    );
$function$;

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
            case when last_message.deleted_at is not null then '🚫 Mensagem apagada' else last_message.text_content end as last_msg_text,
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
              and message.hidden_at is null
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
    pinned as (
        select pin.conversation_id, pin.pinned_at
        from public.conversation_pins as pin
        join caller on caller.member_id = pin.member_id
    ),
    view_filtered as (
        select searched.*, (pinned.conversation_id is not null) as is_pinned, pinned.pinned_at
        from searched
        left join pinned on pinned.conversation_id = searched.conversation_id
        where case coalesce(p_view, 'all')
            when 'archived' then archived_at is not null
            when 'unread' then archived_at is null and is_unread
            when 'groups' then archived_at is null and conversation_type = 'group'
            when 'mine' then archived_at is null and assigned_to_me
            else archived_at is null
        end
    ),
    -- As fixadas (pessoais) vêm todas na primeira página; as demais seguem paginadas pelo cursor como antes.
    filtered as (
        select * from view_filtered where is_pinned and p_cursor_ts is null
        union all
        (
            select *
            from view_filtered
            where not is_pinned
              and (
                  p_cursor_ts is null
                  or (last_activity_at, conversation_id) < (p_cursor_ts, p_cursor_id)
              )
            order by last_activity_at desc, conversation_id desc
            limit greatest(1, least(coalesce(p_limit, 20), 100))
        )
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
        order by filtered.is_pinned desc, filtered.pinned_at desc nulls last, filtered.last_activity_at desc, filtered.conversation_id desc
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
                    'is_self', item.is_self,
                    'is_pinned', item.is_pinned
                ) order by item.is_pinned desc, item.pinned_at desc nulls last, item.last_activity_at desc, item.conversation_id desc
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
            case when last_message.deleted_at is not null then '🚫 Mensagem apagada' else last_message.text_content end as last_msg_text,
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
              and message.hidden_at is null
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
            exists (
                select 1
                from public.conversation_pins as pin
                where pin.conversation_id = filtered.conversation_id
                  and pin.member_id = (select caller_member.member_id from caller as caller_member)
            ) as is_pinned,
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
                    'is_self', item.is_self,
                    'is_pinned', item.is_pinned
                )
    from with_sla as item
    limit 1;
$function$;
