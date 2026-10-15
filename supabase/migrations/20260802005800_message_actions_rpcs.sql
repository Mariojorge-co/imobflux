-- ImobFlux: funções das ações sobre mensagens (responder, editar, apagar, encaminhar, reagir) e do que chega do WhatsApp
-- (edição, exclusão, reação e citação feitas pelo cliente ou pelo celular).
--
-- Só funções NOVAS (nenhuma existente é alterada). SECURITY DEFINER com search_path vazio; permissões explícitas.
--
-- Regras validadas AQUI (não só na tela):
--   * Editar / apagar para todos: só mensagem enviada pelo CRM (origem 'crm', saída), com id do WhatsApp, e só o autor
--     (ATTENDANT) ou o OWNER (qualquer uma enviada pelo CRM). Edição: até 15 min, só texto. Apagar para todos: até 48 h.
--   * Padrão de duas fases: "begin_*" (autenticado) valida e devolve o que a Evolution precisa; o app chama a Evolution;
--     "commit_*" (só o servidor) grava. Assim o navegador nunca consegue gravar edição/exclusão sem a Evolution ter aceitado,
--     e uma falha da Evolution deixa a mensagem como estava.
--   * Apagar para mim (esconder no ImobFlux): qualquer membro com acesso à conversa; só o OWNER restaura. Não mexe no WhatsApp.
--   * Auditoria de editar / apagar / esconder / restaurar / encaminhar, SEM o texto das mensagens.

-- ─── Ajudantes privados ──────────────────────────────────────────────────────────────────────────

-- Rota de saída da conversa: destinatário e instância (a conexão da conversa se ativa; senão a ativa do workspace).
create or replace function private.outgoing_route(p_workspace_id uuid, p_conversation_id uuid)
returns table (recipient_target text, instance_name text, connection_status text)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
    v_channel_connection_id uuid;
    v_thread text;
begin
    select conversation.channel_connection_id, conversation.external_thread_id
    into v_channel_connection_id, v_thread
    from public.conversations as conversation
    where conversation.workspace_id = p_workspace_id
      and conversation.id = p_conversation_id;

    recipient_target := v_thread;

    select connection.external_account_id, connection.status
    into instance_name, connection_status
    from public.channel_connections as connection
    where connection.id = v_channel_connection_id
      and connection.workspace_id = p_workspace_id
      and connection.status = 'active';

    if instance_name is null then
        select connection.external_account_id, connection.status
        into instance_name, connection_status
        from public.channel_connections as connection
        where connection.workspace_id = p_workspace_id
          and connection.provider = 'whatsapp'
          and connection.status = 'active'
        order by connection.activated_at desc nulls last, connection.id
        limit 1;
    end if;

    return next;
end;
$function$;

-- Carrega a mensagem de uma ação, conferindo workspace, acesso à conversa e (opcionalmente) autoria.
create or replace function private.load_action_message(p_message_id uuid, p_require_crm_author boolean)
returns public.messages
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
    v_context record;
    v_message public.messages;
begin
    select context.* into v_context from private.active_member_context() as context limit 1;
    if v_context.member_id is null then
        raise exception 'message_action_not_authorized' using errcode = '42501';
    end if;

    select message.* into v_message
    from public.messages as message
    where message.id = p_message_id
      and message.workspace_id = v_context.workspace_id;
    if v_message.id is null then
        raise exception 'message_not_found' using errcode = 'P0002';
    end if;

    if not private.can_access_conversation(v_message.conversation_id) then
        raise exception 'message_action_not_authorized' using errcode = '42501';
    end if;

    if p_require_crm_author then
        if v_message.origin <> 'crm' or v_message.direction <> 'outgoing' then
            raise exception 'message_action_not_allowed' using errcode = '22023';
        end if;
        if v_context.member_role <> 'owner' and v_message.internal_author_member_id is distinct from v_context.member_id then
            raise exception 'message_action_not_authorized' using errcode = '42501';
        end if;
    end if;

    return v_message;
end;
$function$;

-- Trecho mostrado na citação: quem escreveu, um pedaço do texto e se tem arquivo. Mensagem apagada não mostra o texto.
create or replace function private.message_snapshot(p_message_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
    select jsonb_build_object(
        'author', case
            when message.direction = 'outgoing'
                then coalesce(private.member_display_name(message.workspace_id, message.internal_author_member_id), 'Equipe')
            else coalesce(
                (select contact.display_name
                 from public.contact_points as point
                 join public.contacts as contact on contact.workspace_id = point.workspace_id and contact.id = point.contact_id
                 where point.workspace_id = message.workspace_id and point.id = message.sender_contact_point_id),
                'Contato')
        end,
        'direction', message.direction,
        'text', case when message.deleted_at is not null then null else pg_catalog.left(coalesce(message.text_content, ''), 200) end,
        'deleted', message.deleted_at is not null,
        'has_media', exists (select 1 from public.attachments as attachment where attachment.message_id = message.id)
    )
    from public.messages as message
    where message.id = p_message_id;
$function$;

-- ─── Responder ───────────────────────────────────────────────────────────────────────────────────

create or replace function public.set_message_reply(p_message_id uuid, p_reply_to_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_message public.messages;
    v_target public.messages;
begin
    v_message := private.load_action_message(p_message_id, true);
    if v_message.internal_author_member_id is null
       or v_message.internal_author_member_id <> (select context.member_id from private.active_member_context() as context limit 1) then
        raise exception 'message_action_not_authorized' using errcode = '42501';
    end if;

    select message.* into v_target
    from public.messages as message
    where message.id = p_reply_to_message_id
      and message.workspace_id = v_message.workspace_id
      and message.conversation_id = v_message.conversation_id;
    if v_target.id is null then
        raise exception 'message_not_found' using errcode = 'P0002';
    end if;
    if v_target.deleted_at is not null or v_target.hidden_at is not null then
        raise exception 'message_action_not_allowed' using errcode = '22023';
    end if;

    update public.messages
    set reply_to_message_id = v_target.id,
        reply_to_external_id = v_target.external_message_id,
        reply_snapshot = private.message_snapshot(v_target.id)
    where id = v_message.id;

    return jsonb_build_object('status', 'success', 'message_id', v_message.id, 'reply_to_message_id', v_target.id);
end;
$function$;

-- Citação recebida do WhatsApp (o cliente respondeu a uma mensagem): só o servidor.
create or replace function public.set_incoming_message_reply(
    p_message_id uuid,
    p_quoted_external_id text,
    p_snapshot jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_message public.messages;
    v_original public.messages;
    v_snapshot jsonb;
begin
    if nullif(pg_catalog.btrim(coalesce(p_quoted_external_id, '')), '') is null then
        return jsonb_build_object('status', 'ignored');
    end if;

    select message.* into v_message from public.messages as message where message.id = p_message_id;
    if v_message.id is null then
        raise exception 'message_not_found' using errcode = 'P0002';
    end if;

    select message.* into v_original
    from public.messages as message
    where message.channel_connection_id = v_message.channel_connection_id
      and message.external_message_id = p_quoted_external_id
      and message.conversation_id = v_message.conversation_id;

    if v_original.id is not null then
        v_snapshot := private.message_snapshot(v_original.id);
    else
        -- A original não está no CRM (ex.: anterior à conexão): usa o trecho que veio no próprio evento, limitado.
        v_snapshot := jsonb_build_object(
            'author', pg_catalog.left(coalesce(p_snapshot->>'author', 'Contato'), 80),
            'direction', null,
            'text', pg_catalog.left(coalesce(p_snapshot->>'text', ''), 200),
            'deleted', false,
            'has_media', coalesce((p_snapshot->>'has_media')::boolean, false)
        );
    end if;

    update public.messages
    set reply_to_external_id = p_quoted_external_id,
        reply_to_message_id = v_original.id,
        reply_snapshot = v_snapshot
    where id = v_message.id;

    return jsonb_build_object('status', 'success', 'resolved', v_original.id is not null);
end;
$function$;

-- ─── Editar ──────────────────────────────────────────────────────────────────────────────────────

create or replace function public.begin_message_edit(p_message_id uuid, p_new_text text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_message public.messages;
    v_route record;
    v_text text := pg_catalog.btrim(coalesce(p_new_text, ''));
begin
    v_message := private.load_action_message(p_message_id, true);

    if v_message.deleted_at is not null then
        raise exception 'message_action_not_allowed' using errcode = '22023';
    end if;
    if exists (select 1 from public.attachments as attachment where attachment.message_id = v_message.id) then
        raise exception 'message_edit_not_supported' using errcode = '22023';
    end if;
    if v_message.status not in ('sent', 'delivered', 'read') or v_message.external_message_id is null then
        raise exception 'message_action_not_allowed' using errcode = '22023';
    end if;
    if v_message.occurred_at < pg_catalog.clock_timestamp() - interval '15 minutes' then
        raise exception 'message_edit_window_expired' using errcode = '22023';
    end if;
    if pg_catalog.char_length(v_text) < 1 or pg_catalog.char_length(p_new_text) > 4096 then
        raise exception 'message_text_invalid' using errcode = '22023';
    end if;
    if p_new_text = v_message.text_content then
        raise exception 'message_edit_unchanged' using errcode = '22023';
    end if;

    select * into v_route from private.outgoing_route(v_message.workspace_id, v_message.conversation_id);

    return jsonb_build_object(
        'status', 'ready',
        'message_id', v_message.id,
        'external_message_id', v_message.external_message_id,
        'recipient_target', v_route.recipient_target,
        'instance_name', v_route.instance_name,
        'connection_status', v_route.connection_status,
        'previous_text', v_message.text_content
    );
end;
$function$;

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

-- ─── Apagar para todos ───────────────────────────────────────────────────────────────────────────

create or replace function public.begin_message_revoke(p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_message public.messages;
    v_route record;
begin
    v_message := private.load_action_message(p_message_id, true);

    if v_message.deleted_at is not null then
        raise exception 'message_action_not_allowed' using errcode = '22023';
    end if;
    if v_message.status not in ('sent', 'delivered', 'read') or v_message.external_message_id is null then
        raise exception 'message_action_not_allowed' using errcode = '22023';
    end if;
    if v_message.occurred_at < pg_catalog.clock_timestamp() - interval '48 hours' then
        raise exception 'message_revoke_window_expired' using errcode = '22023';
    end if;

    select * into v_route from private.outgoing_route(v_message.workspace_id, v_message.conversation_id);

    return jsonb_build_object(
        'status', 'ready',
        'message_id', v_message.id,
        'external_message_id', v_message.external_message_id,
        'recipient_target', v_route.recipient_target,
        'instance_name', v_route.instance_name,
        'connection_status', v_route.connection_status
    );
end;
$function$;

-- Grava a exclusão (a pedido do CRM depois de a Evolution aceitar, ou vinda do WhatsApp). O texto original vai para
-- message_deletions (só o OWNER lê) e sai da mensagem; os trechos citados dela também deixam de mostrar o texto.
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

create or replace function public.commit_message_revoke(p_message_id uuid, p_actor_member_id uuid, p_source text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
    if p_source not in ('crm', 'whatsapp') then
        raise exception 'message_source_invalid' using errcode = '22023';
    end if;
    if p_actor_member_id is not null and not exists (
        select 1 from public.workspace_members as member
        join public.messages as message on message.workspace_id = member.workspace_id
        where member.id = p_actor_member_id and message.id = p_message_id
    ) then
        raise exception 'message_action_not_authorized' using errcode = '42501';
    end if;
    return private.apply_message_deletion(p_message_id, p_actor_member_id, p_source);
end;
$function$;

-- ─── Apagar para mim (esconder no ImobFlux) ──────────────────────────────────────────────────────

create or replace function public.hide_message(p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_message public.messages;
    v_member uuid;
    v_now timestamptz := pg_catalog.clock_timestamp();
begin
    v_message := private.load_action_message(p_message_id, false);
    if v_message.hidden_at is not null then
        return jsonb_build_object('status', 'unchanged');
    end if;
    select context.member_id into v_member from private.active_member_context() as context limit 1;

    update public.messages set hidden_at = v_now, hidden_by_member_id = v_member where id = v_message.id;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type, target_id, result, metadata, occurred_at, recorded_at
    ) values (
        v_message.workspace_id, 'member', v_member, 'message.hidden', 'message', v_message.id, 'success', '{}'::jsonb, v_now, v_now
    );

    return jsonb_build_object('status', 'success');
end;
$function$;

create or replace function public.restore_hidden_message(p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_message public.messages;
    v_context record;
    v_now timestamptz := pg_catalog.clock_timestamp();
begin
    select context.* into v_context from private.active_member_context() as context limit 1;
    if v_context.member_id is null or v_context.member_role <> 'owner' then
        raise exception 'message_action_not_authorized' using errcode = '42501';
    end if;
    v_message := private.load_action_message(p_message_id, false);
    if v_message.hidden_at is null then
        return jsonb_build_object('status', 'unchanged');
    end if;

    update public.messages set hidden_at = null, hidden_by_member_id = null where id = v_message.id;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type, target_id, result, metadata, occurred_at, recorded_at
    ) values (
        v_message.workspace_id, 'member', v_context.member_id, 'message.restored', 'message', v_message.id, 'success', '{}'::jsonb, v_now, v_now
    );

    return jsonb_build_object('status', 'success');
end;
$function$;

-- ─── Encaminhar ──────────────────────────────────────────────────────────────────────────────────

-- O que pode ser encaminhado: texto e arquivos já guardados (sem novo upload). Mensagem apagada ou escondida não.
create or replace function public.get_message_for_forward(p_message_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
    v_message public.messages;
begin
    v_message := private.load_action_message(p_message_id, false);
    if v_message.deleted_at is not null or v_message.hidden_at is not null or v_message.status = 'failed' then
        raise exception 'message_action_not_allowed' using errcode = '22023';
    end if;
    return jsonb_build_object(
        'message_id', v_message.id,
        'conversation_id', v_message.conversation_id,
        'text', v_message.text_content,
        'attachments', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', attachment.id,
                'file_name', attachment.original_file_name,
                'mime_type', attachment.mime_type,
                'size_bytes', attachment.size_bytes,
                'storage_bucket', attachment.storage_bucket,
                'storage_key', attachment.storage_key,
                'status', attachment.status
            ) order by attachment.created_at, attachment.id)
            from public.attachments as attachment
            where attachment.message_id = v_message.id
        ), '[]'::jsonb)
    );
end;
$function$;

create or replace function public.mark_message_forwarded(p_message_id uuid, p_source_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_message public.messages;
    v_source public.messages;
    v_member uuid;
    v_now timestamptz := pg_catalog.clock_timestamp();
begin
    v_message := private.load_action_message(p_message_id, true);
    select context.member_id into v_member from private.active_member_context() as context limit 1;
    if v_message.internal_author_member_id is distinct from v_member then
        raise exception 'message_action_not_authorized' using errcode = '42501';
    end if;
    v_source := private.load_action_message(p_source_message_id, false);

    update public.messages set forwarded = true, forwarded_from_message_id = v_source.id where id = v_message.id;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type, target_id, result, metadata, occurred_at, recorded_at
    ) values (
        v_message.workspace_id, 'member', v_member, 'message.forwarded', 'message', v_message.id, 'success',
        pg_catalog.jsonb_build_object('source_message_id', v_source.id), v_now, v_now
    );

    return jsonb_build_object('status', 'success');
end;
$function$;

-- ─── Reações ─────────────────────────────────────────────────────────────────────────────────────

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

-- ─── Vindo do WhatsApp (webhook): só o servidor ──────────────────────────────────────────────────

create or replace function private.find_message_by_external(p_external_account_id text, p_external_message_id text)
returns public.messages
language sql
stable
security definer
set search_path = ''
as $function$
    select message.*
    from public.messages as message
    join public.channel_connections as connection
      on connection.workspace_id = message.workspace_id
     and connection.id = message.channel_connection_id
    where connection.provider = 'whatsapp'
      and connection.external_account_id = p_external_account_id
      and message.external_message_id = p_external_message_id
    limit 1;
$function$;

create or replace function public.ingest_whatsapp_message_edit(
    p_external_account_id text,
    p_external_message_id text,
    p_new_text text,
    p_edited_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_message public.messages;
    v_result jsonb;
begin
    if nullif(pg_catalog.btrim(coalesce(p_new_text, '')), '') is null or pg_catalog.char_length(p_new_text) > 4096 then
        return jsonb_build_object('status', 'ignored', 'reason', 'invalid_text');
    end if;
    v_message := private.find_message_by_external(p_external_account_id, p_external_message_id);
    if v_message.id is null then
        return jsonb_build_object('status', 'ignored', 'reason', 'unknown_message');
    end if;
    -- Edição de mensagem com arquivo (legenda) não é tratada aqui.
    if exists (select 1 from public.attachments as attachment where attachment.message_id = v_message.id) then
        return jsonb_build_object('status', 'ignored', 'reason', 'media_caption');
    end if;
    v_result := public.commit_message_edit(v_message.id, p_new_text, null, 'whatsapp');
    return v_result;
end;
$function$;

create or replace function public.ingest_whatsapp_message_delete(p_external_account_id text, p_external_message_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_message public.messages;
begin
    v_message := private.find_message_by_external(p_external_account_id, p_external_message_id);
    if v_message.id is null then
        return jsonb_build_object('status', 'ignored', 'reason', 'unknown_message');
    end if;
    return private.apply_message_deletion(v_message.id, null, 'whatsapp');
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

-- ─── Permissões ──────────────────────────────────────────────────────────────────────────────────

alter function private.outgoing_route(uuid, uuid) owner to postgres;
alter function private.load_action_message(uuid, boolean) owner to postgres;
alter function private.message_snapshot(uuid) owner to postgres;
alter function private.apply_message_deletion(uuid, uuid, text) owner to postgres;
alter function private.find_message_by_external(text, text) owner to postgres;
revoke all on function private.outgoing_route(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.load_action_message(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function private.message_snapshot(uuid) from public, anon, authenticated, service_role;
revoke all on function private.apply_message_deletion(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.find_message_by_external(text, text) from public, anon, authenticated, service_role;

-- Usuário autenticado (valida e devolve o que o app precisa)
revoke all on function public.set_message_reply(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.begin_message_edit(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.begin_message_revoke(uuid) from public, anon, authenticated, service_role;
revoke all on function public.hide_message(uuid) from public, anon, authenticated, service_role;
revoke all on function public.restore_hidden_message(uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_message_for_forward(uuid) from public, anon, authenticated, service_role;
revoke all on function public.mark_message_forwarded(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.begin_message_reaction(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.set_message_reply(uuid, uuid) to authenticated;
grant execute on function public.begin_message_edit(uuid, text) to authenticated;
grant execute on function public.begin_message_revoke(uuid) to authenticated;
grant execute on function public.hide_message(uuid) to authenticated;
grant execute on function public.restore_hidden_message(uuid) to authenticated;
grant execute on function public.get_message_for_forward(uuid) to authenticated;
grant execute on function public.mark_message_forwarded(uuid, uuid) to authenticated;
grant execute on function public.begin_message_reaction(uuid, text) to authenticated;

-- Só o servidor (grava depois de a Evolution aceitar, ou o que chega pelo webhook)
revoke all on function public.commit_message_edit(uuid, text, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.commit_message_revoke(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.commit_message_reaction(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.set_incoming_message_reply(uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.ingest_whatsapp_message_edit(text, text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.ingest_whatsapp_message_delete(text, text) from public, anon, authenticated, service_role;
revoke all on function public.ingest_whatsapp_reaction(text, text, text, boolean, text) from public, anon, authenticated, service_role;
grant execute on function public.commit_message_edit(uuid, text, uuid, text) to service_role;
grant execute on function public.commit_message_revoke(uuid, uuid, text) to service_role;
grant execute on function public.commit_message_reaction(uuid, uuid, text) to service_role;
grant execute on function public.set_incoming_message_reply(uuid, text, jsonb) to service_role;
grant execute on function public.ingest_whatsapp_message_edit(text, text, text, timestamptz) to service_role;
grant execute on function public.ingest_whatsapp_message_delete(text, text) to service_role;
grant execute on function public.ingest_whatsapp_reaction(text, text, text, boolean, text) to service_role;
