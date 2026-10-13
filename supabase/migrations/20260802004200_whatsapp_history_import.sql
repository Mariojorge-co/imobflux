-- ImobFlux: importação de histórico curto do WhatsApp (últimos 15 dias).
--
-- Quando o número é pareado, o WhatsApp pode enviar um pacote de histórico recente (evento
-- messages.set da Evolution). Ele é importado em melhor esforço e fica marcado como histórico:
--   * messages.is_history identifica a mensagem importada;
--   * histórico NÃO conta para o SLA (sem alerta de atraso, sem "cliente aguardando") nem para
--     "não lida", e não vira a "última mensagem" do cartão do Kanban;
--   * a privacidade é a mesma da ingestão ao vivo (reaproveita as funções de ingestão: contato
--     protegido continua protegido e grupo continua restrito ao OWNER até ser liberado);
--   * o andamento fica em channel_connections (importing/completed/failed) para o OWNER ver
--     na tela quando a importação não for concluída.

alter table public.messages
    add column if not exists is_history boolean not null default false;

alter table public.channel_connections
    add column if not exists history_import_status text,
    add column if not exists history_import_started_at timestamptz,
    add column if not exists history_import_finished_at timestamptz,
    add column if not exists history_imported_count integer not null default 0,
    add column if not exists history_import_error text;

alter table public.channel_connections
    add constraint ck_channel_connections_history_status
        check (history_import_status is null or history_import_status in ('importing', 'completed', 'failed')),
    add constraint ck_channel_connections_history_count
        check (history_imported_count >= 0);

-- Primeiro pareamento (configured -> active): a janela de importação começa.
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

drop trigger if exists trg_start_whatsapp_history_import on public.channel_connections;
create trigger trg_start_whatsapp_history_import
    before update on public.channel_connections
    for each row
    execute function private.start_whatsapp_history_import();

-- Importa um lote de mensagens de histórico. Cada item é isolado: uma falha não derruba o lote.
-- Itens: { external_message_id, remote_jid, sender_jid, from_me, push_name, group_subject, text_content, occurred_at }
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

-- Registra o andamento: soma o importado, guarda o primeiro erro e conclui quando o provedor
-- avisa que o último lote chegou. Erro registrado deixa a importação como "failed" (visível ao OWNER).
create or replace function public.record_whatsapp_history_progress(
    p_external_account_id text,
    p_imported integer,
    p_progress integer,
    p_is_latest boolean,
    p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_connection public.channel_connections%rowtype;
    v_error text := left(nullif(btrim(p_error), ''), 300);
    v_done boolean := coalesce(p_is_latest, false) or coalesce(p_progress, 0) >= 100;
begin
    select * into v_connection
    from public.channel_connections as connection
    where connection.provider = 'whatsapp'
      and connection.external_account_id = p_external_account_id
      and connection.status = 'active'
    for update;

    if not found then
        return jsonb_build_object('status', 'ignored', 'reason', 'no_active_connection');
    end if;

    update public.channel_connections
    set history_imported_count = history_imported_count + greatest(coalesce(p_imported, 0), 0),
        history_import_error = coalesce(history_import_error, v_error),
        history_import_status = case
            when history_import_status is null then history_import_status
            when coalesce(history_import_error, v_error) is not null then 'failed'
            when v_done then 'completed'
            else history_import_status
        end,
        history_import_finished_at = case
            when history_import_status is not null and (v_done or v_error is not null)
                then coalesce(history_import_finished_at, greatest(now(), created_at))
            else history_import_finished_at
        end
    where id = v_connection.id;

    return jsonb_build_object('status', 'success');
end;
$function$;

alter function public.ingest_whatsapp_history_batch(text, jsonb) owner to postgres;
alter function public.record_whatsapp_history_progress(text, integer, integer, boolean, text) owner to postgres;
revoke all on function public.ingest_whatsapp_history_batch(text, jsonb) from public, anon, authenticated;
revoke all on function public.record_whatsapp_history_progress(text, integer, integer, boolean, text) from public, anon, authenticated;
grant execute on function public.ingest_whatsapp_history_batch(text, jsonb) to service_role;
grant execute on function public.record_whatsapp_history_progress(text, integer, integer, boolean, text) to service_role;

-- ─── Leitura: histórico não conta para SLA nem para "não lida" ─────────────────────────────
create or replace function public.get_conversations_inbox(
    p_view text default 'all',
    p_search text default null,
    p_cursor_ts timestamptz default null,
    p_cursor_id uuid default null,
    p_limit integer default 20
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
    with caller as (
        select context.member_id, context.workspace_id, context.member_role
        from private.active_member_context() as context
    ),
    authorized_conversations as (
        select conversation.*
        from public.conversations as conversation
        join caller on caller.workspace_id = conversation.workspace_id
    ),
    projected as (
        select
            conversation.id as conversation_id,
            conversation.conversation_type,
            conversation.visibility,
            conversation.operational_status,
            conversation.archived_at,
            conversation.started_at,
            case
                when conversation.conversation_type = 'group'
                    then coalesce(conversation.subject, 'Grupo WhatsApp')
                else individual_contact.display_name
            end as participant_name,
            case when conversation.conversation_type = 'individual' then point.display_value end as participant_phone,
            case when conversation.conversation_type = 'individual' then individual_contact.id end as contact_id,
            case when conversation.conversation_type = 'individual' and point.external_avatar_url is not null
                 then '/api/contact-avatar/' || point.id::text end as avatar_url,
            last_message.text_content as last_msg_text,
            case when last_message.is_history then null else last_message.direction end as last_msg_direction,
            last_message.occurred_at as last_msg_occurred_at,
            case
                when last_message.internal_author_member_id is not null then author_user.display_name
                when conversation.conversation_type = 'group' then group_sender.external_display_name
                else null
            end as last_msg_author_name,
            coalesce(
                last_message.occurred_at,
                case when caller.member_role = 'attendant' then conversation.commercial_visible_from end,
                conversation.started_at
            ) as last_activity_at,
            (
                coalesce(read_state.is_unread, false)
                or exists (
                    select 1
                    from public.messages as unread_message
                    where unread_message.workspace_id = conversation.workspace_id
                      and unread_message.conversation_id = conversation.id
                      and unread_message.direction = 'incoming'
                      and not unread_message.is_history
                      and unread_message.occurred_at > coalesce(read_state.last_read_at, '-infinity'::timestamptz)
                )
            ) as is_unread
        from authorized_conversations as conversation
        join caller on caller.workspace_id = conversation.workspace_id
        left join lateral (
            select participant.contact_point_id
            from public.conversation_participants as participant
            where participant.workspace_id = conversation.workspace_id
              and participant.conversation_id = conversation.id
              and participant.left_at is null
            order by participant.first_seen_at, participant.id
            limit 1
        ) as primary_participant on true
        left join public.contact_points as point
          on point.workspace_id = conversation.workspace_id
         and point.id = primary_participant.contact_point_id
        left join public.contacts as individual_contact
          on individual_contact.workspace_id = point.workspace_id
         and individual_contact.id = point.contact_id
        left join lateral (
            select message.*
            from public.messages as message
            where message.workspace_id = conversation.workspace_id
              and message.conversation_id = conversation.id
            order by message.occurred_at desc, message.id desc
            limit 1
        ) as last_message on true
        left join public.workspace_members as author_member
          on author_member.workspace_id = last_message.workspace_id
         and author_member.id = last_message.internal_author_member_id
        left join public.app_users as author_user
          on author_user.id = author_member.user_id
        left join public.conversation_participants as group_sender
          on group_sender.workspace_id = last_message.workspace_id
         and group_sender.conversation_id = last_message.conversation_id
         and group_sender.contact_point_id = last_message.sender_contact_point_id
         and group_sender.left_at is null
        left join public.conversation_read_states as read_state
          on read_state.workspace_id = conversation.workspace_id
         and read_state.conversation_id = conversation.id
         and read_state.member_id = caller.member_id
    ),
    searched as (
        select *
        from projected
        where p_search is null
           or btrim(p_search) = ''
           or participant_name ilike '%' || btrim(p_search) || '%'
           or participant_phone ilike '%' || btrim(p_search) || '%'
    ),
    filtered as (
        select *
        from searched
        where case coalesce(p_view, 'all')
            when 'archived' then archived_at is not null
            when 'unread' then archived_at is null and is_unread
            when 'groups' then archived_at is null and conversation_type = 'group'
            else archived_at is null
        end
          and (
              p_cursor_ts is null
              or (last_activity_at, conversation_id) < (p_cursor_ts, p_cursor_id)
          )
        order by last_activity_at desc, conversation_id desc
        limit greatest(1, least(coalesce(p_limit, 20), 100))
    ),
    counts as (
        select
            count(*) filter (where archived_at is null) as all_count,
            count(*) filter (where archived_at is null and is_unread) as unread_count,
            count(*) filter (where archived_at is null and conversation_type = 'group') as group_count,
            count(*) filter (where archived_at is not null) as archived_count,
            count(*) filter (where archived_at is not null and is_unread) as archived_unread_count
        from projected
    )
    select jsonb_build_object(
        'items', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'conversation_id', item.conversation_id,
                    'conversation_type', item.conversation_type,
                    'visibility', item.visibility,
                    'operational_status', item.operational_status,
                    'archived_at', item.archived_at,
                    'started_at', item.started_at,
                    'last_activity_at', item.last_activity_at,
                    'last_msg_text', item.last_msg_text,
                    'last_msg_direction', item.last_msg_direction,
                    'last_msg_occurred_at', item.last_msg_occurred_at,
                    'last_msg_author_name', item.last_msg_author_name,
                    'participant_name', item.participant_name,
                    'participant_phone', item.participant_phone,
                    'contact_id', item.contact_id,
                    'avatar_url', item.avatar_url,
                    'is_unread', item.is_unread
                ) order by item.last_activity_at desc, item.conversation_id desc
            )
            from filtered as item
        ), '[]'::jsonb),
        'counts', (
            select jsonb_build_object(
                'all', counts.all_count,
                'unread', counts.unread_count,
                'groups', counts.group_count,
                'archived', counts.archived_count,
                'archived_unread', counts.archived_unread_count
            )
            from counts
        )
    );
$function$;

revoke all on function public.get_conversations_inbox(text, text, timestamptz, uuid, integer)
from public, anon, service_role;
grant execute on function public.get_conversations_inbox(text, text, timestamptz, uuid, integer)
to authenticated;

-- A conversa passa a informar quais mensagens são histórico importado.
create or replace function public.get_conversation_messages(
    p_conversation_id uuid,
    p_cursor_occurred_at timestamptz default null,
    p_cursor_id uuid default null,
    p_limit integer default 50
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
    with bounded as (
        select greatest(1, least(coalesce(p_limit, 50), 100)) as page_size
    ),
    page as (
        select
            message.id,
            message.direction,
            message.origin,
            message.status,
            message.text_content,
            message.occurred_at,
            message.is_history,
            author_user.display_name as internal_author_name,
            sender.external_display_name as sender_display_name,
            exists (
                select 1
                from public.attachments as attachment
                where attachment.message_id = message.id
            ) as has_attachments,
            coalesce((
                select jsonb_agg(
                    jsonb_build_object(
                        'id', attachment.id,
                        'file_name', attachment.original_file_name,
                        'mime_type', attachment.mime_type,
                        'size_bytes', attachment.size_bytes,
                        'status', attachment.status,
                        'created_at', attachment.created_at
                    ) order by attachment.created_at, attachment.id
                )
                from public.attachments as attachment
                where attachment.message_id = message.id
            ), '[]'::jsonb) as attachments
        from public.messages as message
        left join public.workspace_members as author_member
          on author_member.workspace_id = message.workspace_id
         and author_member.id = message.internal_author_member_id
        left join public.app_users as author_user
          on author_user.id = author_member.user_id
        left join public.conversation_participants as sender
          on sender.workspace_id = message.workspace_id
         and sender.conversation_id = message.conversation_id
         and sender.contact_point_id = message.sender_contact_point_id
         and sender.left_at is null
        where message.conversation_id = p_conversation_id
          and (
              p_cursor_occurred_at is null
              or (message.occurred_at, message.id) < (p_cursor_occurred_at, p_cursor_id)
          )
        order by message.occurred_at desc, message.id desc
        limit (select page_size + 1 from bounded)
    ),
    visible_page as (
        select *
        from page
        order by occurred_at desc, id desc
        limit (select page_size from bounded)
    )
    select jsonb_build_object(
        'messages', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'id', item.id,
                    'direction', item.direction,
                    'origin', item.origin,
                    'status', item.status,
                    'text_content', item.text_content,
                    'occurred_at', item.occurred_at,
                    'is_history', item.is_history,
                    'internal_author_name', item.internal_author_name,
                    'sender_display_name', item.sender_display_name,
                    'has_attachments', item.has_attachments,
                    'attachments', item.attachments
                ) order by item.occurred_at, item.id
            )
            from visible_page as item
        ), '[]'::jsonb),
        'has_more', (select count(*) > (select page_size from bounded) from page)
    );
$function$;

revoke all on function public.get_conversation_messages(uuid, timestamptz, uuid, integer)
from public, anon, service_role;
grant execute on function public.get_conversation_messages(uuid, timestamptz, uuid, integer)
to authenticated;

-- Kanban: a última mensagem do cartão (SLA) ignora histórico.
create or replace function public.get_kanban_board(
    p_limit_per_stage integer default 50
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
    v_limit integer;
    v_board jsonb;
begin
    v_limit := greatest(1, least(coalesce(p_limit_per_stage, 50), 200));

    with active_stages as (
        select s.id as stage_id, s.name, s.position, s.commercial_meaning
        from public.pipeline_stages s
        where s.is_active = true
        order by s.position asc
    ),
    stage_opp_counts as (
        select o.current_stage_id, count(*)::integer as total_count
        from public.opportunities o
        where o.status = 'open' and o.archived_at is null
        group by o.current_stage_id
    ),
    ranked_opps as (
        select
            o.id as opportunity_id, o.current_stage_id, o.title, o.description,
            o.origin, o.property_summary, o.operation_type,
            o.property_type_preference, o.city_region_preference,
            o.value_range_preference, o.created_at, o.updated_at,
            o.sort_order, c.id as contact_id, c.display_name as contact_name,
            c.classification as contact_classification,
            m.id as responsible_member_id, u.display_name as responsible_name,
            (oc_link.conversation_id is not null) as has_linked_conversation,
            oc_link.conversation_id as linked_conversation_id,
            lm.direction as last_msg_direction,
            lm.occurred_at as last_msg_at,
            row_number() over (
                partition by o.current_stage_id
                order by o.sort_order asc, o.id asc
            ) as row_num
        from public.opportunities o
        join public.contacts c on c.id = o.contact_id and c.workspace_id = o.workspace_id
        left join public.workspace_members m on m.id = o.responsible_member_id and m.workspace_id = o.workspace_id
        left join public.app_users u on u.id = m.user_id
        left join lateral (
            select oc.conversation_id
            from public.opportunity_conversations oc
            where oc.opportunity_id = o.id and oc.workspace_id = o.workspace_id and oc.unlinked_at is null
            order by oc.linked_at desc
            limit 1
        ) oc_link on true
        left join lateral (
            select msg.direction, msg.occurred_at
            from public.messages msg
            where msg.conversation_id = oc_link.conversation_id
              and msg.workspace_id = o.workspace_id
              and not msg.is_history
            order by msg.occurred_at desc, msg.id desc
            limit 1
        ) lm on oc_link.conversation_id is not null
        where o.status = 'open' and o.archived_at is null
    ),
    stage_cards as (
        select ro.current_stage_id,
            jsonb_agg(jsonb_build_object(
                'id', ro.opportunity_id, 'title', ro.title, 'description', ro.description,
                'origin', ro.origin, 'property_summary', ro.property_summary,
                'operation_type', ro.operation_type,
                'property_type_preference', ro.property_type_preference,
                'city_region_preference', ro.city_region_preference,
                'value_range_preference', ro.value_range_preference,
                'created_at', ro.created_at, 'updated_at', ro.updated_at,
                'contact_id', ro.contact_id, 'contact_name', ro.contact_name,
                'contact_classification', ro.contact_classification,
                'responsible_member_id', ro.responsible_member_id,
                'responsible_name', ro.responsible_name,
                'has_linked_conversation', ro.has_linked_conversation,
                'linked_conversation_id', ro.linked_conversation_id,
                'last_msg_direction', ro.last_msg_direction,
                'last_msg_at', ro.last_msg_at
            ) order by ro.sort_order asc, ro.opportunity_id asc) as cards
        from ranked_opps ro
        where ro.row_num <= v_limit
        group by ro.current_stage_id
    )
    select jsonb_agg(jsonb_build_object(
        'id', st.stage_id, 'name', st.name, 'position', st.position,
        'commercial_meaning', st.commercial_meaning,
        'total_count', coalesce(cnt.total_count, 0),
        'has_more', (coalesce(cnt.total_count, 0) > v_limit),
        'cards', coalesce(sc.cards, '[]'::jsonb)
    ) order by st.position asc)
    into v_board
    from active_stages st
    left join stage_opp_counts cnt on cnt.current_stage_id = st.stage_id
    left join stage_cards sc on sc.current_stage_id = st.stage_id;

    return coalesce(v_board, '[]'::jsonb);
end;
$function$;

revoke all privileges on function public.get_kanban_board(integer) from public, anon, authenticated;
grant execute on function public.get_kanban_board(integer) to authenticated;
