-- ImobFlux: authorized inbox, manual archive, message read model, and Realtime publication.

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
            last_message.direction as last_msg_direction,
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
                      and unread_message.occurred_at > coalesce(read_state.last_read_at, '-infinity'::timestamptz)
                )
            ) as is_unread
        from authorized_conversations as conversation
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
                    'is_unread', item.is_unread
                ) order by item.last_activity_at desc, item.conversation_id desc
            )
            from filtered as item
        ), '[]'::jsonb),
        'counts', (
            select jsonb_build_object(
                'all', counts.all_count,
                'unread', counts.unread_count,
                'groups', counts.group_count,
                'archived', counts.archived_count,
                'archived_unread', counts.archived_unread_count
            )
            from counts
        )
    );
$function$;

revoke all on function public.get_conversations_inbox(text, text, timestamptz, uuid, integer)
from public, anon, service_role;
grant execute on function public.get_conversations_inbox(text, text, timestamptz, uuid, integer)
to authenticated;

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
            message.text_content,
            message.occurred_at,
            author_user.display_name as internal_author_name,
            sender.external_display_name as sender_display_name,
            exists (
                select 1
                from public.attachments as attachment
                where attachment.message_id = message.id
            ) as has_attachments
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
                    'internal_author_name', item.internal_author_name,
                    'sender_display_name', item.sender_display_name,
                    'has_attachments', item.has_attachments
                ) order by item.occurred_at, item.id
            )
            from visible_page as item
        ), '[]'::jsonb),
        'has_more', (select count(*) > (select page_size from bounded) from page)
    );
$function$;

revoke all on function public.get_conversation_messages(uuid, timestamptz, uuid, integer)
from public, anon, service_role;
grant execute on function public.get_conversation_messages(uuid, timestamptz, uuid, integer)
to authenticated;

create or replace function public.set_conversation_archived(
    p_conversation_id uuid,
    p_archived boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_workspace_id uuid;
    v_member_id uuid;
    v_now timestamptz := statement_timestamp();
begin
    select conversation.workspace_id
    into v_workspace_id
    from public.conversations as conversation
    where conversation.id = p_conversation_id
    for update;

    select context.member_id
    into v_member_id
    from private.active_member_context() as context
    where context.workspace_id = v_workspace_id;

    if v_member_id is null or not private.can_access_conversation(p_conversation_id) then
        raise exception 'conversation_not_available' using errcode = '42501';
    end if;

    update public.conversations
    set operational_status = case when p_archived then 'archived' else 'active' end,
        archived_at = case when p_archived then v_now else null end
    where id = p_conversation_id
      and workspace_id = v_workspace_id;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type,
        target_id, result, metadata, occurred_at, recorded_at
    )
    values (
        v_workspace_id, 'member', v_member_id,
        case when p_archived then 'conversation.archived' else 'conversation.restored' end,
        'conversation', p_conversation_id, 'success', '{}'::jsonb, v_now, v_now
    );

    return jsonb_build_object('success', true, 'archived', p_archived);
end;
$function$;

alter function public.set_conversation_archived(uuid, boolean) owner to postgres;
revoke all on function public.set_conversation_archived(uuid, boolean) from public, anon, service_role;
grant execute on function public.set_conversation_archived(uuid, boolean) to authenticated;

create index if not exists idx_messages_incoming_unread
on public.messages (workspace_id, conversation_id, occurred_at desc, id desc)
where direction = 'incoming';

do $block$
begin
    if not exists (
        select 1 from pg_catalog.pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
    ) then
        alter publication supabase_realtime add table public.messages;
    end if;

    if not exists (
        select 1 from pg_catalog.pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations'
    ) then
        alter publication supabase_realtime add table public.conversations;
    end if;

    if not exists (
        select 1 from pg_catalog.pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversation_read_states'
    ) then
        alter publication supabase_realtime add table public.conversation_read_states;
    end if;
end;
$block$;
