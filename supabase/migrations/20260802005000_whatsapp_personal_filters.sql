-- ImobFlux: WhatsApp pessoal. Quatro chaves por conexão para reduzir ao mínimo o que entra no CRM.
--
--   history_window_days          0 a 15 (padrão 15). 0 = não importar nenhum histórico: o pareamento não marca
--                                "importando" (sem aviso falso na tela) e o lote de histórico é descartado.
--   ingest_groups                padrão FALSE: grupos não são gravados (nem conversa, nem mensagem, nem contato
--                                de participante, nem mídia). Ligue para voltar ao comportamento anterior.
--   ingest_only_known_contacts   padrão FALSE (comportamento anterior: leads novos criam contato). Ligado, só
--                                números JÁ cadastrados em Contatos (não arquivados) entram, tanto de mensagens
--                                recebidas quanto das enviadas por mim pelo celular. Casa o 9º dígito dos
--                                celulares brasileiros (com e sem o 9) e números internacionais (o jid não traz '+'). É um modo de teste, não permanente.
--   ignored_counts               contadores agregados por motivo (group, unknown_contact, invalid_phone),
--                                sem conteúdo e sem número, só para a tela dizer "N mensagens ignoradas".
--
-- Também: lista de transmissão, canal e Status ('@broadcast', '@newsletter') nunca viram conversa individual.
--
-- DADOS EXISTENTES: a conexão de produção ainda NÃO foi pareada (status 'configured', sem histórico), então
-- recebe aqui, de forma explícita (é o número pessoal do dono): history_window_days = 0 (nada de histórico),
-- ingest_only_known_contacts = TRUE (modo de teste: só números já cadastrados) e ingest_groups continua FALSE.
-- O dono desliga o modo de teste em Configurações > WhatsApp quando quiser. Conexões já pareadas, as que já
-- importaram histórico e as futuras ficam com os padrões da coluna (15 dias, grupos e modo desligados).
--
-- Esta migration só adiciona colunas e cria/substitui funções; nenhum dado é apagado.

alter table public.channel_connections
    add column if not exists history_window_days smallint not null default 15,
    add column if not exists ingest_groups boolean not null default false,
    add column if not exists ingest_only_known_contacts boolean not null default false,
    add column if not exists ignored_counts jsonb not null default '{}'::jsonb;

alter table public.channel_connections
    add constraint ck_channel_connections_history_window
        check (history_window_days between 0 and 15),
    add constraint ck_channel_connections_ignored_counts
        check (jsonb_typeof(ignored_counts) = 'object');

update public.channel_connections
set history_window_days = 0,
    ingest_only_known_contacts = true
where provider = 'whatsapp'
  and status = 'configured'
  and activated_at is null
  and history_import_status is null;

-- Variantes de um telefone para comparar com Contatos (9º dígito dos celulares brasileiros).
create or replace function private.phone_match_candidates(p_phone text)
returns text[]
language plpgsql
immutable
strict
set search_path = ''
as $function$
begin
    -- celular com o 9: +55 DD 9 XXXX-XXXX  ->  também sem o 9
    if p_phone ~ '^\+55[0-9]{2}9[0-9]{8}$' then
        return array[p_phone, pg_catalog.substr(p_phone, 1, 5) || pg_catalog.substr(p_phone, 7)];
    end if;
    -- celular antigo sem o 9: +55 DD [6-9]XXX-XXXX  ->  também com o 9 (fixo, que começa com 2 a 5, não muda)
    if p_phone ~ '^\+55[0-9]{2}[6-9][0-9]{7}$' then
        return array[p_phone, pg_catalog.substr(p_phone, 1, 5) || '9' || pg_catalog.substr(p_phone, 6)];
    end if;
    return array[p_phone];
end;
$function$;

alter function private.phone_match_candidates(text) owner to postgres;
revoke all on function private.phone_match_candidates(text) from public, anon, authenticated, service_role;

-- Soma 1 ao contador agregado de mensagens ignoradas da conexão ativa (sem conteúdo, sem número).
create or replace function private.count_ignored_whatsapp_message(p_instance text, p_reason text)
returns void
language plpgsql
set search_path = ''
as $function$
begin
    if p_reason not in ('group', 'unknown_contact', 'invalid_phone') then
        raise exception 'invalid_ignored_reason' using errcode = '22023';
    end if;

    update public.channel_connections as connection
    set ignored_counts = pg_catalog.jsonb_set(
        connection.ignored_counts,
        array[p_reason],
        pg_catalog.to_jsonb(coalesce((connection.ignored_counts ->> p_reason)::bigint, 0) + 1),
        true
    )
    where connection.provider = 'whatsapp'
      and connection.external_account_id = p_instance
      and connection.status = 'active';
end;
$function$;

alter function private.count_ignored_whatsapp_message(text, text) owner to postgres;
revoke all on function private.count_ignored_whatsapp_message(text, text) from public, anon, authenticated, service_role;

-- Pareamento: só marca "importando" quando a conexão importa histórico (janela maior que 0).
create or replace function private.start_whatsapp_history_import()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
    if old.status = 'configured' and new.status = 'active' and new.history_window_days > 0 then
        new.history_import_status := 'importing';
        new.history_import_started_at := now();
        new.history_import_finished_at := null;
        new.history_imported_count := 0;
        new.history_import_error := null;
    end if;
    return new;
end;
$function$;

-- O app precisa da janela ao conectar (para assinar ou não o histórico): o registro passa a devolvê-la.
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
        'connection_status', (select connection.status from public.channel_connections as connection where connection.id = v_connection.id),
        'history_window_days', (select connection.history_window_days from public.channel_connections as connection where connection.id = v_connection.id)
    );
end;
$function$;

-- Entrada de grupos, individual e histórico (definições vigentes + as chaves acima).
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
    v_ingest_groups boolean;
begin
    if p_group_jid is null or p_group_jid not like '%@g.us' then
        return jsonb_build_object('status', 'ignored', 'reason', 'invalid_group');
    end if;

    select connection.id, connection.workspace_id, connection.ingest_groups
    into v_channel_connection_id, v_workspace_id, v_ingest_groups
    from public.channel_connections as connection
    where connection.provider = 'whatsapp'
      and connection.external_account_id = p_external_account_id
      and connection.status = 'active';

    if v_channel_connection_id is null then
        raise exception 'active_whatsapp_connection_not_found' using errcode = '42704';
    end if;

    -- Grupos desligados (padrão): nada é gravado (nem conversa, nem mensagem, nem contato de participante).
    if not v_ingest_groups then
        perform private.count_ignored_whatsapp_message(p_external_account_id, 'group');
        return jsonb_build_object('status', 'ignored', 'reason', 'groups_disabled');
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
    v_cutoff timestamptz;
    v_window smallint;
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
    select connection.history_window_days
    into v_window
    from public.channel_connections as connection
    where connection.provider = 'whatsapp'
      and connection.external_account_id = p_external_account_id
      and connection.status = 'active';
    if not found then
        raise exception 'active_whatsapp_connection_not_found' using errcode = '42704';
    end if;

    -- Janela 0: esta conexão não importa histórico; o lote é descartado inteiro.
    if v_window = 0 then
        return jsonb_build_object(
            'status', 'success', 'imported', 0, 'duplicate', 0,
            'ignored', jsonb_array_length(p_messages), 'failed', 0,
            'first_error', null, 'reason', 'history_disabled'
        );
    end if;
    v_cutoff := now() - pg_catalog.make_interval(days => v_window::integer);

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

-- OWNER: liga/desliga as chaves da conexão atual (a ativa; senão a mais recente não substituída).
-- Parâmetro nulo = não muda. A janela de histórico só muda antes do pareamento (é no pareamento
-- que o WhatsApp envia o histórico). Mudança real gera evento de auditoria (sem dados de clientes).
create or replace function public.update_whatsapp_ingest_settings(
    p_ingest_groups boolean default null,
    p_only_known_contacts boolean default null,
    p_history_window_days integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_workspace_id uuid;
    v_member_id uuid;
    v_connection public.channel_connections%rowtype;
    v_now timestamptz := now();
    v_changes jsonb := '[]'::jsonb;
begin
    select context.workspace_id, context.member_id
    into v_workspace_id, v_member_id
    from private.active_member_context() as context
    where context.member_role = 'owner';

    if v_member_id is null then
        raise exception 'whatsapp_settings_not_authorized' using errcode = '42501';
    end if;

    if p_history_window_days is not null and p_history_window_days not between 0 and 15 then
        raise exception 'invalid_whatsapp_history_window' using errcode = '22023';
    end if;

    select * into v_connection
    from public.channel_connections as connection
    where connection.workspace_id = v_workspace_id
      and connection.provider = 'whatsapp'
      and connection.status <> 'replaced'
    order by (connection.status = 'active') desc, connection.created_at desc
    limit 1
    for update;

    if not found then
        raise exception 'whatsapp_channel_not_found' using errcode = 'P0002';
    end if;

    if p_history_window_days is not null
       and p_history_window_days is distinct from v_connection.history_window_days
       and v_connection.status <> 'configured' then
        raise exception 'whatsapp_history_window_locked' using errcode = '55000';
    end if;

    if p_ingest_groups is not null and p_ingest_groups is distinct from v_connection.ingest_groups then
        v_changes := v_changes || jsonb_build_object('key', 'ingest_groups', 'from', v_connection.ingest_groups, 'to', p_ingest_groups);
    end if;
    if p_only_known_contacts is not null and p_only_known_contacts is distinct from v_connection.ingest_only_known_contacts then
        v_changes := v_changes || jsonb_build_object('key', 'ingest_only_known_contacts', 'from', v_connection.ingest_only_known_contacts, 'to', p_only_known_contacts);
    end if;
    if p_history_window_days is not null and p_history_window_days is distinct from v_connection.history_window_days then
        v_changes := v_changes || jsonb_build_object('key', 'history_window_days', 'from', v_connection.history_window_days, 'to', p_history_window_days);
    end if;

    if jsonb_array_length(v_changes) > 0 then
        update public.channel_connections
        set ingest_groups = coalesce(p_ingest_groups, ingest_groups),
            ingest_only_known_contacts = coalesce(p_only_known_contacts, ingest_only_known_contacts),
            history_window_days = coalesce(p_history_window_days, history_window_days)::smallint
        where id = v_connection.id;

        insert into public.audit_events (
            workspace_id, actor_type, actor_member_id, action, target_type,
            target_id, result, metadata, occurred_at, recorded_at
        )
        values (
            v_workspace_id, 'member', v_member_id, 'whatsapp.ingest_settings_changed',
            'channel_connection', v_connection.id, 'success',
            jsonb_build_object('changes', v_changes), v_now, v_now
        );
    end if;

    return jsonb_build_object(
        'status', 'success',
        'changed', jsonb_array_length(v_changes) > 0,
        'connection_id', v_connection.id
    );
end;
$function$;

alter function public.update_whatsapp_ingest_settings(boolean, boolean, integer) owner to postgres;
revoke all on function public.update_whatsapp_ingest_settings(boolean, boolean, integer) from public, anon, service_role;
grant execute on function public.update_whatsapp_ingest_settings(boolean, boolean, integer) to authenticated;
