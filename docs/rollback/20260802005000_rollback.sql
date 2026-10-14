-- ROLLBACK da migration 20260802005000_whatsapp_personal_filters.sql (manual; NÃO é uma migration).
--
-- Devolve as funções de entrada do WhatsApp (grupo, individual, histórico) e o gatilho do histórico ao estado
-- anterior (003800 e 004200) e remove as funções novas. As COLUNAS (history_window_days, ingest_groups,
-- ingest_only_known_contacts, ignored_counts) ficam: são inofensivas sem a migration e apagá-las perderia a
-- configuração do dono. Para removê-las de vez, descomente o bloco final (apaga os valores).
-- Os valores que a migration gravou na conexão existente (janela 0, modo só cadastrados) ficam nas colunas; sem as funções novas
-- eles não têm efeito. Para o comportamento antigo de verdade, o rollback abaixo basta.
-- Efeito no uso: volta a gravar grupos e a importar 15 dias de histórico, e o modo "só cadastrados" deixa de existir.
-- O app desta branch continua abrindo (as colunas ainda existem), mas a tela de filtros não terá efeito.
-- Se a migration for considerada revertida: supabase migration repair --status reverted 20260802005000
--
-- Como usar (produção, só com autorização): begin; \\i este-arquivo.sql; -- conferir; commit;

begin;

create or replace function private.start_whatsapp_history_import()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
    if old.status = 'configured' and new.status = 'active' then
        new.history_import_status := 'importing';
        new.history_import_started_at := now();
        new.history_import_finished_at := null;
        new.history_imported_count := 0;
        new.history_import_error := null;
    end if;
    return new;
end;
$function$;

create or replace function public.register_whatsapp_channel(p_instance_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_workspace_id uuid;
    v_member_id uuid;
    v_now timestamptz := now();
    v_connection public.channel_connections%rowtype;
    v_registered boolean := false;
begin
    select context.workspace_id, context.member_id
    into v_workspace_id, v_member_id
    from private.active_member_context() as context
    where context.member_role = 'owner';

    if v_member_id is null then
        raise exception 'whatsapp_channel_not_authorized' using errcode = '42501';
    end if;

    if p_instance_name is null or p_instance_name !~ '^[a-z0-9][a-z0-9-]{2,62}$' then
        raise exception 'invalid_whatsapp_instance_name' using errcode = '22023';
    end if;

    select * into v_connection
    from public.channel_connections as connection
    where connection.provider = 'whatsapp'
      and connection.external_account_id = p_instance_name
    for update;

    if found then
        if v_connection.workspace_id <> v_workspace_id then
            raise exception 'whatsapp_instance_in_use' using errcode = '42501';
        end if;

        if v_connection.status in ('disconnected', 'replaced') then
            update public.channel_connections
            set status = 'configured',
                activated_at = null,
                paused_at = null,
                disconnected_at = null
            where id = v_connection.id;
            v_registered := true;
        end if;
    else
        insert into public.channel_connections (
            workspace_id, provider, external_account_id, display_name, status
        )
        values (v_workspace_id, 'whatsapp', p_instance_name, 'WhatsApp', 'configured')
        returning * into v_connection;
        v_registered := true;
    end if;

    if v_registered then
        insert into public.audit_events (
            workspace_id, actor_type, actor_member_id, action, target_type,
            target_id, result, metadata, occurred_at, recorded_at
        )
        values (
            v_workspace_id, 'member', v_member_id, 'whatsapp.channel_registered',
            'channel_connection', v_connection.id, 'success',
            jsonb_build_object('provider', 'whatsapp'), v_now, v_now
        );
    end if;

    return jsonb_build_object(
        'status', 'success',
        'connection_id', v_connection.id,
        'connection_status', (select connection.status from public.channel_connections as connection where connection.id = v_connection.id)
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
    v_cutoff timestamptz := now() - interval '15 days';
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
    if not exists (
        select 1 from public.channel_connections as connection
        where connection.provider = 'whatsapp'
          and connection.external_account_id = p_external_account_id
          and connection.status = 'active'
    ) then
        raise exception 'active_whatsapp_connection_not_found' using errcode = '42704';
    end if;

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

drop function if exists public.update_whatsapp_ingest_settings(boolean, boolean, integer);
drop function if exists private.count_ignored_whatsapp_message(text, text);
drop function if exists private.phone_match_candidates(text);

-- alter table public.channel_connections
--     drop constraint if exists ck_channel_connections_history_window,
--     drop constraint if exists ck_channel_connections_ignored_counts,
--     drop column if exists history_window_days,
--     drop column if exists ingest_groups,
--     drop column if exists ingest_only_known_contacts,
--     drop column if exists ignored_counts;

commit;
