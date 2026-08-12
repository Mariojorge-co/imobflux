-- ImobFlux Sprint 23 Hotfix: Estado de Cadastro de Contatos (registration_status)

-- 1. Adicionar coluna registration_status na tabela public.contacts
alter table public.contacts
    add column if not exists registration_status text not null default 'confirmed';

-- Constraint para limitar a ('provisional', 'confirmed')
do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'ck_contacts_registration_status'
    ) then
        alter table public.contacts
            add constraint ck_contacts_registration_status
            check (registration_status in ('provisional', 'confirmed'));
    end if;
end $$;

-- 2. Atualizar RPC ingest_whatsapp_text_message para registrar contatos auto-criados como 'provisional'
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

        -- Contatos auto-criados ao receber mensagens pelo WhatsApp entram com registration_status = 'provisional'
        insert into public.contacts (
            workspace_id,
            display_name,
            classification,
            operational_status,
            registration_status
        ) values (
            v_workspace_id,
            v_display_name,
            'person',
            'active',
            'provisional'
        ) returning id into v_contact_id;

        insert into public.contact_points (
            workspace_id,
            contact_id,
            point_type,
            normalized_value,
            display_value,
            operational_status
        ) values (
            v_workspace_id,
            v_contact_id,
            'phone',
            v_normalized_phone,
            v_raw_phone,
            'active'
        ) returning id into v_contact_point_id;
    end if;

    -- 6. Resolver ou criar conversa individual para este canal + contato
    select c.id
    into v_conversation_id
    from public.conversations c
    join public.conversation_participants cp on cp.workspace_id = c.workspace_id and cp.conversation_id = c.id
    where c.workspace_id = v_workspace_id
      and c.channel_connection_id = v_channel_connection_id
      and c.conversation_type = 'individual'
      and cp.contact_point_id = v_contact_point_id
    limit 1;

    if v_conversation_id is null then
        insert into public.conversations (
            workspace_id,
            channel_connection_id,
            external_thread_id,
            conversation_type,
            visibility,
            operational_status,
            started_at
        ) values (
            v_workspace_id,
            v_channel_connection_id,
            p_remote_jid,
            'individual',
            'commercial',
            'active',
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

    -- 9. Atualizar timestamps da conversa
    update public.conversations
    set updated_at = now()
    where id = v_conversation_id;

    return jsonb_build_object(
        'status', 'ingested',
        'message_id', v_message_id,
        'conversation_id', v_conversation_id,
        'contact_id', v_contact_id
    );
end;
$$;

revoke all privileges on function public.ingest_whatsapp_text_message(text, text, text, boolean, text, text, timestamptz)
from public, anon, authenticated;

grant execute on function public.ingest_whatsapp_text_message(text, text, text, boolean, text, text, timestamptz)
to service_role;
