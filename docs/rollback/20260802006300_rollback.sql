-- ROLLBACK da migration 20260802006300_message_actions_post_test.sql (manual; NÃO é uma migration).
--
-- Devolve as funções às definições anteriores (005800/006000/006200) e remove a coluna wa_pending_action. As reações
-- duplicadas que a migration limpou NÃO voltam (eram duplicatas). O app desta versão lê wa_pending_action: reverta o app
-- antes ou junto. Se a migration for considerada revertida: supabase migration repair --status reverted 20260802006300
-- Como usar (produção, só com autorização): begin; i este-arquivo.sql; -- conferir; commit;

begin;

create or replace function public.commit_message_edit(
    p_message_id uuid,
    p_new_text text,
    p_actor_member_id uuid,
    p_source text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_message public.messages;
    v_now timestamptz := pg_catalog.clock_timestamp();
begin
    if p_source not in ('crm', 'whatsapp') then
        raise exception 'message_source_invalid' using errcode = '22023';
    end if;
    if p_new_text is null or pg_catalog.btrim(p_new_text) = '' or pg_catalog.char_length(p_new_text) > 4096 then
        raise exception 'message_text_invalid' using errcode = '22023';
    end if;

    select message.* into v_message from public.messages as message where message.id = p_message_id for update;
    if v_message.id is null then
        raise exception 'message_not_found' using errcode = 'P0002';
    end if;
    if p_actor_member_id is not null and not exists (
        select 1 from public.workspace_members as member
        where member.id = p_actor_member_id and member.workspace_id = v_message.workspace_id
    ) then
        raise exception 'message_action_not_authorized' using errcode = '42501';
    end if;
    if v_message.deleted_at is not null then
        return jsonb_build_object('status', 'ignored', 'reason', 'deleted');
    end if;
    if v_message.text_content is not distinct from p_new_text then
        return jsonb_build_object('status', 'unchanged');
    end if;

    insert into public.message_edits (workspace_id, message_id, previous_text, new_text, edited_at, edited_by_member_id, source)
    values (v_message.workspace_id, v_message.id, v_message.text_content, p_new_text, v_now, p_actor_member_id, p_source);

    update public.messages
    set text_content = p_new_text, edited_at = v_now, edit_count = edit_count + 1
    where id = v_message.id;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type, target_id, result, metadata, occurred_at, recorded_at
    ) values (
        v_message.workspace_id,
        case when p_actor_member_id is null then 'system' else 'member' end,
        p_actor_member_id, 'message.edited', 'message', v_message.id, 'success',
        pg_catalog.jsonb_build_object('source', p_source), v_now, v_now
    );

    return jsonb_build_object('status', 'success', 'edited_at', v_now);
end;
$function$;

create or replace function private.apply_message_deletion(p_message_id uuid, p_actor_member_id uuid, p_source text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_message public.messages;
    v_now timestamptz := pg_catalog.clock_timestamp();
begin
    select message.* into v_message from public.messages as message where message.id = p_message_id for update;
    if v_message.id is null then
        raise exception 'message_not_found' using errcode = 'P0002';
    end if;
    if v_message.deleted_at is not null then
        return jsonb_build_object('status', 'unchanged');
    end if;

    insert into public.message_deletions (workspace_id, message_id, original_text, deleted_at, deleted_by_member_id, source)
    values (v_message.workspace_id, v_message.id, v_message.text_content, v_now, p_actor_member_id, p_source);

    update public.messages
    set text_content = null, deleted_at = v_now, deleted_by_member_id = p_actor_member_id, deleted_source = p_source
    where id = v_message.id;

    update public.messages
    set reply_snapshot = coalesce(reply_snapshot, '{}'::jsonb) || jsonb_build_object('text', null, 'deleted', true)
    where workspace_id = v_message.workspace_id
      and reply_to_message_id = v_message.id;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type, target_id, result, metadata, occurred_at, recorded_at
    ) values (
        v_message.workspace_id,
        case when p_actor_member_id is null then 'system' else 'member' end,
        p_actor_member_id, 'message.deleted_for_everyone', 'message', v_message.id, 'success',
        pg_catalog.jsonb_build_object('source', p_source), v_now, v_now
    );

    return jsonb_build_object('status', 'success', 'deleted_at', v_now);
end;
$function$;

create or replace function public.begin_message_reaction(p_message_id uuid, p_emoji text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_message public.messages;
    v_conversation public.conversations;
    v_route record;
    v_member uuid;
    v_emoji text := coalesce(p_emoji, '');
begin
    v_message := private.load_action_message(p_message_id, false);
    select context.member_id into v_member from private.active_member_context() as context limit 1;

    if v_message.deleted_at is not null or v_message.external_message_id is null or v_message.status = 'failed' then
        raise exception 'message_action_not_allowed' using errcode = '22023';
    end if;
    if pg_catalog.char_length(v_emoji) > 16 then
        raise exception 'reaction_invalid' using errcode = '22023';
    end if;

    select conversation.* into v_conversation from public.conversations as conversation where conversation.id = v_message.conversation_id;
    if v_conversation.conversation_type <> 'individual' then
        raise exception 'reaction_not_supported_group' using errcode = '22023';
    end if;

    select * into v_route from private.outgoing_route(v_message.workspace_id, v_message.conversation_id);

    return jsonb_build_object(
        'status', 'ready',
        'message_id', v_message.id,
        'external_message_id', v_message.external_message_id,
        'from_me', v_message.direction = 'outgoing',
        'recipient_target', v_route.recipient_target,
        'instance_name', v_route.instance_name,
        'connection_status', v_route.connection_status,
        'current_emoji', (select reaction.emoji from public.message_reactions as reaction
                          where reaction.message_id = v_message.id and reaction.member_id = v_member)
    );
end;
$function$;

create or replace function public.commit_message_reaction(p_message_id uuid, p_actor_member_id uuid, p_emoji text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_message public.messages;
    v_emoji text := pg_catalog.btrim(coalesce(p_emoji, ''));
begin
    select message.* into v_message from public.messages as message where message.id = p_message_id;
    if v_message.id is null then
        raise exception 'message_not_found' using errcode = 'P0002';
    end if;
    if not exists (
        select 1 from public.workspace_members as member
        where member.id = p_actor_member_id and member.workspace_id = v_message.workspace_id
    ) then
        raise exception 'message_action_not_authorized' using errcode = '42501';
    end if;
    if pg_catalog.char_length(v_emoji) > 16 then
        raise exception 'reaction_invalid' using errcode = '22023';
    end if;

    if v_emoji = '' then
        delete from public.message_reactions where message_id = v_message.id and member_id = p_actor_member_id;
        return jsonb_build_object('status', 'removed');
    end if;

    insert into public.message_reactions (workspace_id, message_id, member_id, emoji)
    values (v_message.workspace_id, v_message.id, p_actor_member_id, v_emoji)
    on conflict (message_id, member_id) where member_id is not null
    do update set emoji = excluded.emoji;
    return jsonb_build_object('status', 'success', 'emoji', v_emoji);
end;
$function$;

create or replace function public.ingest_whatsapp_reaction(
    p_external_account_id text,
    p_target_external_id text,
    p_reactor_jid text,
    p_from_me boolean,
    p_emoji text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_message public.messages;
    v_phone text;
    v_point_id uuid;
    v_emoji text := pg_catalog.btrim(coalesce(p_emoji, ''));
begin
    if pg_catalog.char_length(v_emoji) > 16 then
        return jsonb_build_object('status', 'ignored', 'reason', 'invalid_emoji');
    end if;
    v_message := private.find_message_by_external(p_external_account_id, p_target_external_id);
    if v_message.id is null then
        return jsonb_build_object('status', 'ignored', 'reason', 'unknown_message');
    end if;
    if v_message.deleted_at is not null then
        return jsonb_build_object('status', 'ignored', 'reason', 'deleted');
    end if;

    if p_from_me then
        -- Reação feita pelo próprio aparelho/conta (não por um membro do CRM).
        if v_emoji = '' then
            delete from public.message_reactions where message_id = v_message.id and is_account;
            return jsonb_build_object('status', 'removed');
        end if;
        -- Eco de uma reação que um membro acabou de enviar pelo ImobFlux: já existe, não duplica.
        if exists (
            select 1
            from public.message_reactions as reaction
            where reaction.message_id = v_message.id
              and reaction.member_id is not null
              and reaction.emoji = v_emoji
              and reaction.updated_at >= pg_catalog.clock_timestamp() - interval '2 minutes'
        ) then
            return jsonb_build_object('status', 'ignored', 'reason', 'echo');
        end if;
        insert into public.message_reactions (workspace_id, message_id, is_account, emoji)
        values (v_message.workspace_id, v_message.id, true, v_emoji)
        on conflict (message_id) where is_account do update set emoji = excluded.emoji;
        return jsonb_build_object('status', 'success');
    end if;

    v_phone := public.normalize_brazilian_phone(pg_catalog.split_part(coalesce(p_reactor_jid, ''), '@', 1));
    select point.id into v_point_id
    from public.contact_points as point
    where point.workspace_id = v_message.workspace_id
      and point.point_type = 'phone'
      and point.normalized_value = v_phone
    limit 1;
    if v_point_id is null then
        return jsonb_build_object('status', 'ignored', 'reason', 'unknown_reactor');
    end if;

    if v_emoji = '' then
        delete from public.message_reactions where message_id = v_message.id and contact_point_id = v_point_id;
        return jsonb_build_object('status', 'removed');
    end if;
    insert into public.message_reactions (workspace_id, message_id, contact_point_id, emoji)
    values (v_message.workspace_id, v_message.id, v_point_id, v_emoji)
    on conflict (message_id, contact_point_id) where contact_point_id is not null do update set emoji = excluded.emoji;
    return jsonb_build_object('status', 'success');
end;
$function$;

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

alter table public.messages drop constraint if exists ck_messages_wa_pending_action;
alter table public.messages drop column if exists wa_pending_action;

commit;
