-- Permite operações autorizadas em conversas arquivadas sem recolocá-las na inbox.

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

alter function public.queue_outgoing_text_message(uuid, text, uuid) owner to postgres;
revoke all on function public.queue_outgoing_text_message(uuid, text, uuid) from public, anon, service_role;
grant execute on function public.queue_outgoing_text_message(uuid, text, uuid) to authenticated;
