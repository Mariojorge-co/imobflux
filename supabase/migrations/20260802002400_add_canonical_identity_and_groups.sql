-- ImobFlux: canonical Brazilian phone identities, external avatars, groups, and safe conversation resolution.

create or replace function public.normalize_brazilian_phone(p_value text)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $function$
declare
    v_digits text := regexp_replace(p_value, '[^0-9]', '', 'g');
begin
    if length(v_digits) in (10, 11) then
        return '+55' || v_digits;
    end if;

    if length(v_digits) in (12, 13) and v_digits like '55%' then
        return '+' || v_digits;
    end if;

    return null;
end;
$function$;

alter function public.normalize_brazilian_phone(text) owner to postgres;
revoke all on function public.normalize_brazilian_phone(text) from public, anon, service_role;
grant execute on function public.normalize_brazilian_phone(text) to authenticated;

do $block$
begin
    if exists (
        select 1
        from public.contact_points as point
        where point.point_type = 'phone'
        group by point.workspace_id, public.normalize_brazilian_phone(point.normalized_value)
        having public.normalize_brazilian_phone(point.normalized_value) is null
            or count(*) > 1
    ) then
        raise exception 'canonical_phone_backfill_requires_manual_review'
            using errcode = '23505';
    end if;

    update public.contact_points
    set normalized_value = public.normalize_brazilian_phone(normalized_value)
    where point_type = 'phone'
      and normalized_value is distinct from public.normalize_brazilian_phone(normalized_value);
end;
$block$;

alter table public.contact_points
    add column if not exists external_avatar_url text;

alter table public.contact_points
    drop constraint if exists ck_contact_points_phone_canonical;

alter table public.contact_points
    add constraint ck_contact_points_phone_canonical
    check (
        point_type <> 'phone'
        or normalized_value = public.normalize_brazilian_phone(normalized_value)
    );

alter table public.contact_points
    drop constraint if exists ck_contact_points_external_avatar_nonempty;

alter table public.contact_points
    add constraint ck_contact_points_external_avatar_nonempty
    check (external_avatar_url is null or btrim(external_avatar_url) <> '');

create or replace function public.resolve_or_start_individual_conversation(
    p_contact_id uuid default null,
    p_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_workspace_id uuid;
    v_member_id uuid;
    v_member_role text;
    v_contact_id uuid;
    v_contact_point_id uuid;
    v_phone text;
    v_channel_connection_id uuid;
    v_conversation_id uuid;
    v_now timestamptz := statement_timestamp();
    v_is_protected boolean;
begin
    select context.workspace_id, context.member_id, context.member_role
    into v_workspace_id, v_member_id, v_member_role
    from private.active_member_context() as context;

    if v_member_id is null then
        raise exception 'conversation_not_available' using errcode = '42501';
    end if;

    v_phone := public.normalize_brazilian_phone(p_phone);

    if p_contact_id is not null then
        select contact.id, contact.is_protected
        into v_contact_id, v_is_protected
        from public.contacts as contact
        where contact.id = p_contact_id
          and contact.workspace_id = v_workspace_id;

        if v_contact_id is null
           or (v_member_role = 'attendant' and not private.can_access_contact(v_contact_id)) then
            raise exception 'conversation_not_available' using errcode = '42501';
        end if;

        select point.id, point.normalized_value
        into v_contact_point_id, v_phone
        from public.contact_points as point
        where point.workspace_id = v_workspace_id
          and point.contact_id = v_contact_id
          and point.point_type = 'phone'
          and point.operational_status = 'active'
          and (v_phone is null or point.normalized_value = v_phone)
        order by point.created_at, point.id
        limit 1;
    elsif v_phone is not null then
        select point.id, point.contact_id
        into v_contact_point_id, v_contact_id
        from public.contact_points as point
        where point.workspace_id = v_workspace_id
          and point.point_type = 'phone'
          and point.normalized_value = v_phone
          and point.operational_status = 'active';

        if v_contact_id is not null
           and v_member_role = 'attendant'
           and not private.can_access_contact(v_contact_id) then
            raise exception 'conversation_not_available' using errcode = '42501';
        end if;
    end if;

    if v_contact_point_id is null and v_phone is null then
        raise exception 'conversation_not_available' using errcode = '42501';
    end if;

    if v_contact_id is null then
        insert into public.contacts (
            workspace_id,
            display_name,
            classification,
            operational_status,
            registration_status,
            is_protected,
            commercial_visible_from
        )
        values (
            v_workspace_id,
            'Contato ' || v_phone,
            'person',
            'active',
            'provisional',
            false,
            v_now
        )
        returning id into v_contact_id;

        if v_contact_point_id is null then
            insert into public.contact_points (
                workspace_id,
                contact_id,
                point_type,
                normalized_value,
                display_value,
                operational_status,
                is_protected,
                commercial_visible_from
            )
            values (
                v_workspace_id,
                v_contact_id,
                'phone',
                v_phone,
                v_phone,
                'active',
                false,
                v_now
            )
            returning id into v_contact_point_id;
        else
            update public.contact_points
            set contact_id = v_contact_id,
                commercial_visible_from = v_now
            where id = v_contact_point_id
              and workspace_id = v_workspace_id
              and contact_id is null;
        end if;
    end if;

    if v_contact_point_id is null then
        raise exception 'conversation_not_available' using errcode = '42501';
    end if;

    select connection.id
    into v_channel_connection_id
    from public.channel_connections as connection
    where connection.workspace_id = v_workspace_id
      and connection.provider = 'whatsapp'
      and connection.status = 'active'
    order by connection.activated_at desc, connection.id
    limit 1;

    if v_channel_connection_id is null then
        raise exception 'conversation_not_available' using errcode = '42501';
    end if;

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

    if v_conversation_id is not null then
        return jsonb_build_object(
            'status', 'existing',
            'conversation_id', v_conversation_id,
            'contact_id', v_contact_id
        );
    end if;

    select contact.is_protected
    into v_is_protected
    from public.contacts as contact
    where contact.id = v_contact_id;

    insert into public.conversations (
        workspace_id,
        channel_connection_id,
        external_thread_id,
        conversation_type,
        operational_status,
        visibility,
        commercial_visible_from,
        privacy_changed_at,
        started_at
    )
    values (
        v_workspace_id,
        v_channel_connection_id,
        substring(v_phone from 2) || '@s.whatsapp.net',
        'individual',
        'active',
        case when v_is_protected then 'owner_only' else 'commercial' end,
        case when v_is_protected then null else v_now end,
        v_now,
        v_now
    )
    returning id into v_conversation_id;

    insert into public.conversation_participants (
        workspace_id,
        conversation_id,
        contact_point_id,
        first_seen_at
    )
    values (
        v_workspace_id,
        v_conversation_id,
        v_contact_point_id,
        v_now
    );

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type,
        target_id, result, metadata, occurred_at, recorded_at
    )
    values (
        v_workspace_id, 'member', v_member_id, 'conversation.started',
        'conversation', v_conversation_id, 'success',
        jsonb_build_object('contact_id', v_contact_id), v_now, v_now
    );

    return jsonb_build_object(
        'status', 'created',
        'conversation_id', v_conversation_id,
        'contact_id', v_contact_id
    );
exception
    when unique_violation then
        raise exception 'conversation_not_available' using errcode = '42501';
end;
$function$;

alter function public.resolve_or_start_individual_conversation(uuid, text) owner to postgres;
revoke all on function public.resolve_or_start_individual_conversation(uuid, text) from public, anon, service_role;
grant execute on function public.resolve_or_start_individual_conversation(uuid, text) to authenticated;

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
                is_protected, commercial_visible_from
            )
            values (
                v_workspace_id, null, 'phone', v_sender_phone,
                v_sender_phone, nullif(btrim(p_push_name), ''), 'active',
                false, v_occurred_at
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
            conversation_type, operational_status, visibility, subject, started_at
        )
        values (
            v_workspace_id, v_channel_connection_id, p_group_jid,
            'group', 'active', 'owner_only',
            coalesce(nullif(btrim(p_group_subject), ''), 'Grupo WhatsApp'),
            v_occurred_at
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

alter function public.ingest_whatsapp_group_text_message(text, text, text, text, boolean, text, text, text, timestamptz) owner to postgres;
revoke all on function public.ingest_whatsapp_group_text_message(text, text, text, text, boolean, text, text, text, timestamptz)
from public, anon, authenticated;
grant execute on function public.ingest_whatsapp_group_text_message(text, text, text, text, boolean, text, text, text, timestamptz)
to service_role;

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
            registration_status, is_protected, commercial_visible_from
        )
        values (
            v_workspace_id, v_display_name, 'person', 'active',
            'provisional', false, v_occurred_at
        )
        returning id into v_contact_id;

        insert into public.contact_points (
            workspace_id, contact_id, point_type, normalized_value,
            display_value, external_display_name, operational_status,
            is_protected, commercial_visible_from
        )
        values (
            v_workspace_id, v_contact_id, 'phone', v_normalized_phone,
            v_normalized_phone,
            case when not p_from_me then nullif(btrim(p_push_name), '') end,
            'active',
            false, v_occurred_at
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
                registration_status, is_protected, commercial_visible_from
            )
            values (
                v_workspace_id, v_display_name, 'person', 'active',
                'provisional', false, v_occurred_at
            )
            returning id into v_contact_id;

            update public.contact_points
            set contact_id = v_contact_id,
                commercial_visible_from = v_occurred_at
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
            commercial_visible_from, privacy_changed_at, started_at
        )
        values (
            v_workspace_id, v_channel_connection_id, p_remote_jid,
            'individual', 'active',
            case when v_is_protected then 'owner_only' else 'commercial' end,
            case when v_is_protected then null else v_occurred_at end,
            v_occurred_at, v_occurred_at
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

alter function public.ingest_whatsapp_text_message(text, text, text, boolean, text, text, timestamptz) owner to postgres;
revoke all on function public.ingest_whatsapp_text_message(text, text, text, boolean, text, text, timestamptz)
from public, anon, authenticated;
grant execute on function public.ingest_whatsapp_text_message(text, text, text, boolean, text, text, timestamptz)
to service_role;
