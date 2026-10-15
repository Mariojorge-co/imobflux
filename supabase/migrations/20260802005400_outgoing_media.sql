-- ImobFlux: envio de arquivos pelo WhatsApp (imagem, vídeo, áudio, documentos).
--
-- Os arquivos enviados ficam no MESMO bucket privado das mídias recebidas ('whatsapp-media', limite de 25 MB já
-- definido): a rota autorizada /api/attachments/[id] e a RLS de `attachments` já protegem a leitura com as mesmas
-- regras de privacidade, e o limite do bucket já é o pedido. O bucket continua SEM policies em storage.objects: o
-- navegador nunca lê nem grava direto; ele só recebe, do servidor, uma URL de upload assinada e específica de UM caminho
-- (`<workspace>/<conversa>/out/<uuid>`) depois que o servidor confirma que a pessoa acessa a conversa.
--
-- Esta migration só ADICIONA funções (nenhuma tabela, coluna ou função existente muda):
--   * queue_outgoing_media_message: enfileira a mensagem de saída com o anexo já guardado (mesmo padrão e mesmas
--     permissões de queue_outgoing_text_message), exigindo que a chave do arquivo esteja dentro do workspace e da
--     conversa informados, e validando nome, tamanho e tipo declarados.
--   * record_outgoing_media_sent: auditoria 'message.file_sent' (sem nome do arquivo), só para o servidor.
--   * list_orphan_outbound_uploads: lista uploads que nunca viraram mensagem (varredura), só para o servidor.

create or replace function public.queue_outgoing_media_message(
    p_conversation_id uuid,
    p_client_idempotency_key uuid,
    p_storage_key text,
    p_file_name text,
    p_mime_type text,
    p_size_bytes bigint,
    p_text_content text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_context record;
    v_existing_message_id uuid;
    v_existing_status text;
    v_existing_attachment_id uuid;
    v_channel_connection_id uuid;
    v_external_thread_id text;
    v_message_id uuid;
    v_attachment_id uuid;
    v_instance_name text;
    v_connection_status text;
    v_name text := pg_catalog.btrim(coalesce(p_file_name, ''));
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
        select attachment.id into v_existing_attachment_id
        from public.attachments as attachment
        where attachment.workspace_id = v_context.workspace_id
          and attachment.message_id = v_existing_message_id
        limit 1;
        return jsonb_build_object(
            'status', 'duplicate',
            'message_id', v_existing_message_id,
            'message_status', v_existing_status,
            'attachment_id', v_existing_attachment_id
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

    -- O arquivo só pode estar no caminho deste workspace e desta conversa (nunca de outro).
    if p_storage_key is null
       or p_storage_key !~ ('^' || v_context.workspace_id::text || '/' || p_conversation_id::text || '/out/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
        raise exception 'media_storage_key_invalid' using errcode = '22023';
    end if;

    if pg_catalog.char_length(v_name) < 1 or pg_catalog.char_length(v_name) > 120
       or pg_catalog.strpos(v_name, '/') > 0 or pg_catalog.strpos(v_name, chr(92)) > 0 then
        raise exception 'media_file_name_invalid' using errcode = '22023';
    end if;

    if p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 26214400 then
        raise exception 'media_size_invalid' using errcode = '22023';
    end if;

    if nullif(pg_catalog.btrim(coalesce(p_mime_type, '')), '') is null or pg_catalog.char_length(p_mime_type) > 127 then
        raise exception 'media_mime_invalid' using errcode = '22023';
    end if;

    if nullif(pg_catalog.btrim(coalesce(p_text_content, '')), '') is null or pg_catalog.char_length(p_text_content) > 4096 then
        raise exception 'message_content_empty' using errcode = '22023';
    end if;

    select connection.external_account_id, connection.status
    into v_instance_name, v_connection_status
    from public.channel_connections as connection
    where connection.id = v_channel_connection_id
      and connection.workspace_id = v_context.workspace_id
      and connection.status = 'active';

    if v_instance_name is null then
        select connection.external_account_id, connection.status
        into v_instance_name, v_connection_status
        from public.channel_connections as connection
        where connection.workspace_id = v_context.workspace_id
          and connection.provider = 'whatsapp'
          and connection.status = 'active'
        order by connection.activated_at desc nulls last, connection.id
        limit 1;
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

    begin
        insert into public.attachments (
            workspace_id, message_id, storage_bucket, storage_key,
            original_file_name, mime_type, size_bytes, status, available_at
        ) values (
            v_context.workspace_id, v_message_id, 'whatsapp-media', p_storage_key,
            v_name, p_mime_type, p_size_bytes, 'available', statement_timestamp()
        ) returning id into v_attachment_id;
    exception when unique_violation then
        raise exception 'media_object_already_used' using errcode = '23505';
    end;

    return jsonb_build_object(
        'status', 'queued',
        'message_id', v_message_id,
        'attachment_id', v_attachment_id,
        'conversation_id', p_conversation_id,
        'channel_connection_id', v_channel_connection_id,
        'recipient_target', v_external_thread_id,
        'instance_name', v_instance_name,
        'connection_status', v_connection_status
    );
exception
    when unique_violation then
        -- Chave de idempotência repetida em paralelo: devolve a mensagem que já existe.
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

alter function public.queue_outgoing_media_message(uuid, uuid, text, text, text, bigint, text) owner to postgres;
revoke all on function public.queue_outgoing_media_message(uuid, uuid, text, text, text, bigint, text) from public, anon, service_role;
grant execute on function public.queue_outgoing_media_message(uuid, uuid, text, text, text, bigint, text) to authenticated;

-- Auditoria do envio de arquivo (só o servidor chama, depois que o WhatsApp aceitou). Sem nome nem conteúdo.
create or replace function public.record_outgoing_media_sent(
    p_message_id uuid,
    p_media_kind text
) returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_message record;
    v_size bigint;
    v_now timestamptz := pg_catalog.clock_timestamp();
begin
    if p_media_kind not in ('image', 'video', 'audio', 'document') then
        raise exception 'media_kind_invalid' using errcode = '22023';
    end if;

    select message.workspace_id, message.internal_author_member_id
    into v_message
    from public.messages as message
    where message.id = p_message_id
      and message.direction = 'outgoing'
      and message.origin = 'crm'
      and message.internal_author_member_id is not null;

    if v_message.workspace_id is null then
        raise exception 'message_not_found' using errcode = 'P0002';
    end if;

    if exists (
        select 1 from public.audit_events as event
        where event.workspace_id = v_message.workspace_id
          and event.action = 'message.file_sent'
          and event.target_id = p_message_id
    ) then
        return;
    end if;

    select coalesce(sum(attachment.size_bytes), 0)
    into v_size
    from public.attachments as attachment
    where attachment.workspace_id = v_message.workspace_id
      and attachment.message_id = p_message_id;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type,
        target_id, result, metadata, occurred_at, recorded_at
    ) values (
        v_message.workspace_id, 'member', v_message.internal_author_member_id, 'message.file_sent',
        'message', p_message_id, 'success',
        pg_catalog.jsonb_build_object('media_kind', p_media_kind, 'size_bytes', v_size), v_now, v_now
    );
end;
$function$;

alter function public.record_outgoing_media_sent(uuid, text) owner to postgres;
revoke all on function public.record_outgoing_media_sent(uuid, text) from public, anon, authenticated;
grant execute on function public.record_outgoing_media_sent(uuid, text) to service_role;

-- Varredura de uploads órfãos: arquivos em `<workspace>/<conversa>/out/` que nunca viraram mensagem (a pessoa
-- escolheu o arquivo e desistiu, fechou a aba, ou o envio falhou antes de gravar). Só lista; quem apaga é o servidor.
create or replace function public.list_orphan_outbound_uploads(
    p_older_than interval default interval '1 day'
) returns setof text
language sql
stable
security definer
set search_path = ''
as $function$
    select object.name
    from storage.objects as object
    where object.bucket_id = 'whatsapp-media'
      and object.name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/out/[0-9a-f-]{36}$'
      and object.created_at < pg_catalog.now() - coalesce(p_older_than, interval '1 day')
      and not exists (
          select 1 from public.attachments as attachment
          where attachment.storage_bucket = 'whatsapp-media'
            and attachment.storage_key = object.name
      )
    order by object.created_at, object.name
    limit 1000;
$function$;

alter function public.list_orphan_outbound_uploads(interval) owner to postgres;
revoke all on function public.list_orphan_outbound_uploads(interval) from public, anon, authenticated;
grant execute on function public.list_orphan_outbound_uploads(interval) to service_role;
