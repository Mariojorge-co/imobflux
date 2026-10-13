-- ImobFlux: WhatsApp ingestion failed for every new number in production.
--
-- The ingest functions stored the WhatsApp message time (p_occurred_at) as the
-- commercial_visible_from / privacy_changed_at of newly created contacts, contact points and
-- conversations, but the table checks require those values to be >= created_at (the moment the
-- row reaches the database). A message is always older than its arrival, so the first message
-- from any new number raised ck_contacts_timestamps and the webhook answered 500. The pgTAP
-- suite did not catch it because it used now() as the message time inside one transaction.
--
-- Fix: rows created by ingestion are born at v_epoch = least(message time, transaction time (now(), the default of created_at/updated_at)).
-- created_at, started_at and the visibility epoch all use v_epoch, so the constraints hold,
-- the first message stays visible to the team (visible_from <= its occurred_at) and a message
-- timestamp slightly ahead of the database clock cannot break updated_at >= created_at.

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
begin
    if p_group_jid is null or p_group_jid not like '%@g.us' then
        return jsonb_build_object('status', 'ignored', 'reason', 'invalid_group');
    end if;

    select connection.id, connection.workspace_id
    into v_channel_connection_id, v_workspace_id
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
begin
    if p_remote_jid is null or p_remote_jid like '%@g.us' then
        return jsonb_build_object('status', 'ignored', 'reason', 'group_requires_group_ingest');
    end if;

    v_normalized_phone := public.normalize_brazilian_phone(split_part(p_remote_jid, '@', 1));
    if v_normalized_phone is null then
        return jsonb_build_object('status', 'ignored', 'reason', 'invalid_phone');
    end if;

    select connection.id, connection.workspace_id
    into v_channel_connection_id, v_workspace_id
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

alter function public.ingest_whatsapp_group_text_message(text, text, text, text, boolean, text, text, text, timestamptz) owner to postgres;
revoke all on function public.ingest_whatsapp_group_text_message(text, text, text, text, boolean, text, text, text, timestamptz)
from public, anon, authenticated;
grant execute on function public.ingest_whatsapp_group_text_message(text, text, text, text, boolean, text, text, text, timestamptz)
to service_role;

alter function public.ingest_whatsapp_text_message(text, text, text, boolean, text, text, timestamptz) owner to postgres;
revoke all on function public.ingest_whatsapp_text_message(text, text, text, boolean, text, text, timestamptz)
from public, anon, authenticated;
grant execute on function public.ingest_whatsapp_text_message(text, text, text, boolean, text, text, timestamptz)
to service_role;
