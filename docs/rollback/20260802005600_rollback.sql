-- ROLLBACK da migration 20260802005600_self_conversation_ingest.sql (manual; NÃO é uma migration).
--
-- Devolve ingest_whatsapp_text_message à definição da migration 20260802005100 (o próprio número da conexão volta a ser
-- ignorado no modo "só contatos cadastrados"). Nenhum dado é tocado; contatos "Mensagens para você" já criados continuam.
-- Se a migration for considerada revertida: supabase migration repair --status reverted 20260802005600
-- Como usar (produção, só com autorização): begin; \i este-arquivo.sql; -- conferir; commit;

begin;

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

    -- Mensagem do cliente numa conversa encerrada (arquivada) reabre a conversa: ela volta à lista e ao SLA.
    -- Mensagem nossa não reabre, e o histórico importado também não (a importação liga o aviso abaixo).
    if not p_from_me and coalesce(pg_catalog.current_setting('imobflux.skip_reopen', true), '') <> '1' then
        update public.conversations as reopened
        set operational_status = 'active',
            archived_at = null
        where reopened.id = v_conversation_id
          and reopened.operational_status = 'archived';
        if found then
            insert into public.audit_events (
                workspace_id, actor_type, actor_member_id, action, target_type,
                target_id, result, metadata, occurred_at, recorded_at
            )
            values (
                v_workspace_id, 'system', null, 'conversation.reopened', 'conversation',
                v_conversation_id, 'success', '{}'::jsonb, statement_timestamp(), statement_timestamp()
            );
        end if;
    end if;

    return jsonb_build_object(
        'status', 'success',
        'message_id', v_message_id,
        'conversation_id', v_conversation_id,
        'contact_id', v_contact_id,
        'from_me', p_from_me
    );
end;
$function$;

commit;
