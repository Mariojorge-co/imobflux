-- ImobFlux Sprint 17.1: WhatsApp Text Integration RPCs
-- Ingestão atômica de mensagens entrantes, enfileiramento local e reconciliação de status.

-- ─── 1. RPC public.ingest_whatsapp_text_message ──────────────────────────────

create or replace function public.ingest_whatsapp_text_message(
    p_external_account_id text,
    p_external_message_id text,
    p_remote_jid text,
    p_from_me boolean,
    p_push_name text,
    p_text_content text,
    p_occurred_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_channel_connection_id uuid;
    v_workspace_id uuid;
    v_existing_message_id uuid;
    v_raw_phone text;
    v_normalized_phone text;
    v_contact_point_id uuid;
    v_contact_id uuid;
    v_conversation_id uuid;
    v_message_id uuid;
    v_display_name text;
    v_occurred_ts timestamptz;
begin
    -- 1. Ignorar graciosamente se for evento de grupo ou sem remoteJid válido
    if p_remote_jid is null or p_remote_jid ilike '%@g.us' or strpos(p_remote_jid, '@') = 0 then
        return jsonb_build_object(
            'status', 'ignored',
            'reason', 'group_event_ignored'
        );
    end if;

    -- 2. Localizar canal ativo por provider + external_account_id
    select id, workspace_id
    into v_channel_connection_id, v_workspace_id
    from public.channel_connections
    where provider = 'whatsapp'
      and external_account_id = p_external_account_id
      and status = 'active';

    if v_channel_connection_id is null then
        raise exception 'Conexão ativa do WhatsApp não encontrada para a conta %', p_external_account_id
            using errcode = '42704';
    end if;

    -- 3. Idempotência por channel_connection_id + external_message_id
    select id
    into v_existing_message_id
    from public.messages
    where channel_connection_id = v_channel_connection_id
      and external_message_id = p_external_message_id;

    if v_existing_message_id is not null then
        return jsonb_build_object(
            'status', 'duplicate',
            'message_id', v_existing_message_id
        );
    end if;

    v_occurred_ts := coalesce(p_occurred_at, now());

    -- 4. Extrair e normalizar número de telefone do destinatário/remetente individual
    v_raw_phone := split_part(p_remote_jid, '@', 1);
    v_normalized_phone := '+' || regexp_replace(v_raw_phone, '\D', '', 'g');

    -- 5. Resolver ou criar contato e contact_point para o número individual
    select cp.id, cp.contact_id
    into v_contact_point_id, v_contact_id
    from public.contact_points cp
    where cp.workspace_id = v_workspace_id
      and cp.point_type = 'phone'
      and cp.normalized_value = v_normalized_phone;

    if v_contact_point_id is null then
        -- Se p_from_me = false, usar pushName se válido/não vazio; se p_from_me = true ou pushName inválido, usar formato neutro
        if not p_from_me and p_push_name is not null and btrim(p_push_name) <> '' then
            v_display_name := btrim(p_push_name);
        else
            v_display_name := 'Contato ' || v_normalized_phone;
        end if;

        insert into public.contacts (
            workspace_id,
            display_name,
            classification,
            operational_status
        ) values (
            v_workspace_id,
            v_display_name,
            'person',
            'active'
        ) returning id into v_contact_id;

        insert into public.contact_points (
            workspace_id,
            contact_id,
            point_type,
            normalized_value,
            display_value,
            external_display_name,
            operational_status
        ) values (
            v_workspace_id,
            v_contact_id,
            'phone',
            v_normalized_phone,
            v_normalized_phone,
            case when not p_from_me and p_push_name is not null and btrim(p_push_name) <> '' then btrim(p_push_name) else null end,
            'active'
        ) returning id into v_contact_point_id;
    end if;

    -- 6. Resolver ou criar conversa individual
    select id
    into v_conversation_id
    from public.conversations
    where workspace_id = v_workspace_id
      and channel_connection_id = v_channel_connection_id
      and external_thread_id = p_remote_jid;

    if v_conversation_id is null then
        insert into public.conversations (
            workspace_id,
            channel_connection_id,
            external_thread_id,
            conversation_type,
            operational_status,
            visibility,
            started_at
        ) values (
            v_workspace_id,
            v_channel_connection_id,
            p_remote_jid,
            'individual',
            'active',
            'commercial',
            v_occurred_ts
        ) returning id into v_conversation_id;
    end if;

    -- 7. Garantir participante vinculado à conversa
    insert into public.conversation_participants (
        workspace_id,
        conversation_id,
        contact_point_id,
        first_seen_at
    ) values (
        v_workspace_id,
        v_conversation_id,
        v_contact_point_id,
        v_occurred_ts
    )
    on conflict (conversation_id, contact_point_id) where contact_point_id is not null and left_at is null
    do update set last_seen_at = greatest(public.conversation_participants.first_seen_at, v_occurred_ts);

    -- 8. Inserir mensagem de acordo com a direção (fromMe)
    if not p_from_me then
        insert into public.messages (
            workspace_id,
            channel_connection_id,
            conversation_id,
            direction,
            origin,
            status,
            sender_contact_point_id,
            internal_author_member_id,
            text_content,
            occurred_at,
            external_message_id,
            external_created_at,
            received_at
        ) values (
            v_workspace_id,
            v_channel_connection_id,
            v_conversation_id,
            'incoming',
            'whatsapp',
            'received',
            v_contact_point_id,
            null,
            p_text_content,
            v_occurred_ts,
            p_external_message_id,
            v_occurred_ts,
            now()
        ) returning id into v_message_id;
    else
        insert into public.messages (
            workspace_id,
            channel_connection_id,
            conversation_id,
            direction,
            origin,
            status,
            sender_contact_point_id,
            internal_author_member_id,
            text_content,
            occurred_at,
            external_message_id,
            external_created_at,
            received_at
        ) values (
            v_workspace_id,
            v_channel_connection_id,
            v_conversation_id,
            'outgoing',
            'whatsapp',
            'sent',
            null,
            null,
            p_text_content,
            v_occurred_ts,
            p_external_message_id,
            v_occurred_ts,
            now()
        ) returning id into v_message_id;
    end if;

    return jsonb_build_object(
        'status', 'success',
        'message_id', v_message_id,
        'conversation_id', v_conversation_id,
        'contact_id', v_contact_id,
        'from_me', p_from_me
    );
end;
$$;

alter function public.ingest_whatsapp_text_message(text, text, text, boolean, text, text, timestamptz) owner to postgres;

revoke all privileges on function public.ingest_whatsapp_text_message(text, text, text, boolean, text, text, timestamptz)
from public, anon, authenticated;

grant execute on function public.ingest_whatsapp_text_message(text, text, text, boolean, text, text, timestamptz)
to service_role;


-- ─── 2. RPC public.queue_outgoing_text_message ───────────────────────────────

create or replace function public.queue_outgoing_text_message(
    p_conversation_id uuid,
    p_text_content text,
    p_client_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_app_user_id uuid;
    v_member_id uuid;
    v_workspace_id uuid;
    v_existing_message_id uuid;
    v_existing_status text;
    v_channel_connection_id uuid;
    v_external_thread_id text;
    v_message_id uuid;
begin
    -- 1. Resolver contexto autenticado do usuário do workspace ativo
    select app_user_id, member_id, workspace_id
    into v_app_user_id, v_member_id, v_workspace_id
    from private.active_owner_context();

    if v_workspace_id is null then
        raise exception 'Acesso não autorizado ou sessão ativa ausente'
            using errcode = '42501';
    end if;

    -- 2. Validar idempotência local por client_idempotency_key no workspace
    select id, status
    into v_existing_message_id, v_existing_status
    from public.messages
    where workspace_id = v_workspace_id
      and client_idempotency_key = p_client_idempotency_key;

    if v_existing_message_id is not null then
        return jsonb_build_object(
            'status', 'duplicate',
            'message_id', v_existing_message_id,
            'message_status', v_existing_status
        );
    end if;

    -- 3. Validar se a conversa pertence ao workspace e está ativa
    select channel_connection_id, external_thread_id
    into v_channel_connection_id, v_external_thread_id
    from public.conversations
    where workspace_id = v_workspace_id
      and id = p_conversation_id
      and operational_status = 'active';

    if v_channel_connection_id is null then
        raise exception 'Conversa não encontrada ou inativa no workspace'
            using errcode = '42704';
    end if;

    -- 4. Validar conteúdo não vazio
    if p_text_content is null or btrim(p_text_content) = '' then
        raise exception 'O conteúdo da mensagem não pode ser vazio'
            using errcode = '22023';
    end if;

    -- 5. Inserir mensagem de saída com status queued
    insert into public.messages (
        workspace_id,
        channel_connection_id,
        conversation_id,
        direction,
        origin,
        status,
        sender_contact_point_id,
        internal_author_member_id,
        client_idempotency_key,
        text_content,
        occurred_at
    ) values (
        v_workspace_id,
        v_channel_connection_id,
        p_conversation_id,
        'outgoing',
        'crm',
        'queued',
        null,
        v_member_id,
        p_client_idempotency_key,
        p_text_content,
        now()
    ) returning id into v_message_id;

    return jsonb_build_object(
        'status', 'queued',
        'message_id', v_message_id,
        'conversation_id', p_conversation_id,
        'channel_connection_id', v_channel_connection_id,
        'recipient_target', v_external_thread_id
    );
end;
$$;

alter function public.queue_outgoing_text_message(uuid, text, uuid) owner to postgres;

revoke all privileges on function public.queue_outgoing_text_message(uuid, text, uuid)
from public, anon;

grant execute on function public.queue_outgoing_text_message(uuid, text, uuid)
to authenticated;


-- ─── 3. RPC public.reconcile_outgoing_text_message ────────────────────────────

create or replace function public.reconcile_outgoing_text_message(
    p_message_id uuid,
    p_target_status text,
    p_external_message_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_updated_rows int;
begin
    if p_target_status not in ('sent', 'failed') then
        raise exception 'Status de reconciliação inválido: %', p_target_status
            using errcode = '22023';
    end if;

    update public.messages
    set status = p_target_status,
        external_message_id = case when p_target_status = 'sent' then coalesce(p_external_message_id, external_message_id) else external_message_id end,
        status_updated_at = now()
    where id = p_message_id
      and status = 'queued';

    get diagnostics v_updated_rows = row_count;

    if v_updated_rows = 0 then
        raise exception 'Mensagem com id % não encontrada para reconciliação ou não está em status queued', p_message_id
            using errcode = '42704';
    end if;

    return jsonb_build_object(
        'status', 'success',
        'message_id', p_message_id,
        'target_status', p_target_status
    );
end;
$$;

alter function public.reconcile_outgoing_text_message(uuid, text, text) owner to postgres;

revoke all privileges on function public.reconcile_outgoing_text_message(uuid, text, text)
from public, anon, authenticated;

grant execute on function public.reconcile_outgoing_text_message(uuid, text, text)
to service_role;
