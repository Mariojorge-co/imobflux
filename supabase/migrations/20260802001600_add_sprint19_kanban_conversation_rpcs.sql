-- ImobFlux Sprint 19: Commercial Flow Consolidation (Kanban ↔ Conversations)
-- Atomic RPCs for opportunity editing, logical archiving, conversation eligibility & bidirectional linking.

-- ─── 1. RPC public.get_kanban_board (Sprint 19 Update with Conversation Info)

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
        select
            s.id as stage_id,
            s.name,
            s.position,
            s.commercial_meaning
        from public.pipeline_stages s
        where s.is_active = true
        order by s.position asc
    ),
    stage_opp_counts as (
        select
            o.current_stage_id,
            count(*)::integer as total_count
        from public.opportunities o
        where o.status = 'open'
          and o.archived_at is null
        group by o.current_stage_id
    ),
    ranked_opps as (
        select
            o.id as opportunity_id,
            o.current_stage_id,
            o.title,
            o.description,
            o.created_at,
            o.updated_at,
            c.id as contact_id,
            c.display_name as contact_name,
            c.classification as contact_classification,
            m.id as responsible_member_id,
            u.display_name as responsible_name,
            (oc_link.conversation_id is not null) as has_linked_conversation,
            oc_link.conversation_id as linked_conversation_id,
            row_number() over (
                partition by o.current_stage_id
                order by o.updated_at desc, o.id desc
            ) as row_num
        from public.opportunities o
        join public.contacts c
          on c.id = o.contact_id
         and c.workspace_id = o.workspace_id
        left join public.workspace_members m
          on m.id = o.responsible_member_id
         and m.workspace_id = o.workspace_id
        left join public.app_users u
          on u.id = m.user_id
        left join lateral (
            select oc.conversation_id
            from public.opportunity_conversations oc
            where oc.opportunity_id = o.id
              and oc.workspace_id = o.workspace_id
              and oc.unlinked_at is null
            order by oc.linked_at desc
            limit 1
        ) oc_link on true
        where o.status = 'open'
          and o.archived_at is null
    ),
    stage_cards as (
        select
            ro.current_stage_id,
            jsonb_agg(
                jsonb_build_object(
                    'id', ro.opportunity_id,
                    'title', ro.title,
                    'description', ro.description,
                    'created_at', ro.created_at,
                    'updated_at', ro.updated_at,
                    'contact_id', ro.contact_id,
                    'contact_name', ro.contact_name,
                    'contact_classification', ro.contact_classification,
                    'responsible_member_id', ro.responsible_member_id,
                    'responsible_name', ro.responsible_name,
                    'has_linked_conversation', ro.has_linked_conversation,
                    'linked_conversation_id', ro.linked_conversation_id
                )
                order by ro.updated_at desc, ro.opportunity_id desc
            ) as cards
        from ranked_opps ro
        where ro.row_num <= v_limit
        group by ro.current_stage_id
    )
    select jsonb_agg(
        jsonb_build_object(
            'id', st.stage_id,
            'name', st.name,
            'position', st.position,
            'commercial_meaning', st.commercial_meaning,
            'total_count', coalesce(cnt.total_count, 0),
            'has_more', (coalesce(cnt.total_count, 0) > v_limit),
            'cards', coalesce(sc.cards, '[]'::jsonb)
        )
        order by st.position asc
    )
    into v_board
    from active_stages st
    left join stage_opp_counts cnt on cnt.current_stage_id = st.stage_id
    left join stage_cards sc on sc.current_stage_id = st.stage_id;

    return coalesce(v_board, '[]'::jsonb);
end;
$function$;

revoke all privileges on function public.get_kanban_board(integer) from public, anon, authenticated;
grant execute on function public.get_kanban_board(integer) to authenticated;


-- ─── 2. RPC public.update_opportunity ───────────────────────────────────────

create or replace function public.update_opportunity(
    p_opportunity_id uuid,
    p_title text,
    p_description text default null,
    p_stage_id uuid default null,
    p_contact_id uuid default null,
    p_responsible_member_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
    v_context_count bigint;
    v_workspace_id uuid;
    v_member_id uuid;
    v_current_title text;
    v_current_description text;
    v_current_stage_id uuid;
    v_current_contact_id uuid;
    v_current_responsible_id uuid;
    v_opp_status text;
    v_opp_archived_at timestamptz;
    v_new_title text;
    v_new_description text;
    v_has_linked_conversation boolean;
    v_occurred_at timestamptz := pg_catalog.statement_timestamp();
begin
    select count(*)
    into v_context_count
    from private.active_owner_context();

    if v_context_count <> 1 then
        raise exception 'opportunity_operation_not_authorized'
            using errcode = '42501';
    end if;

    select workspace_id, member_id
    into v_workspace_id, v_member_id
    from private.active_owner_context();

    -- Busca estado atual da oportunidade com FOR UPDATE
    select
        title,
        description,
        current_stage_id,
        contact_id,
        responsible_member_id,
        status,
        archived_at
    into
        v_current_title,
        v_current_description,
        v_current_stage_id,
        v_current_contact_id,
        v_current_responsible_id,
        v_opp_status,
        v_opp_archived_at
    from public.opportunities
    where id = p_opportunity_id
      and workspace_id = v_workspace_id
    for update;

    if v_current_stage_id is null then
        raise exception 'opportunity_not_found'
            using errcode = '42704';
    end if;

    if v_opp_status <> 'open' or v_opp_archived_at is not null then
        raise exception 'opportunity_not_open'
            using errcode = '55000';
    end if;

    -- Validação de título não vazio
    v_new_title := pg_catalog.btrim(p_title);
    if v_new_title is null or v_new_title = '' then
        raise exception 'opportunity_title_invalid'
            using errcode = '22023';
    end if;

    v_new_description := pg_catalog.btrim(p_description);
    if v_new_description = '' then
        v_new_description := null;
    end if;

    -- Regra da Sprint 19: Bloqueio de troca do contato se houver conversa vinculada
    if p_contact_id is not null and p_contact_id <> v_current_contact_id then
        select exists (
            select 1
            from public.opportunity_conversations
            where workspace_id = v_workspace_id
              and opportunity_id = p_opportunity_id
              and unlinked_at is null
        ) into v_has_linked_conversation;

        if v_has_linked_conversation then
            return jsonb_build_object(
                'status', 'CONTACT_CHANGE_BLOCKED_BY_CONVERSATION',
                'error', 'Não é possível alterar o contato de uma oportunidade que possui conversa vinculada.'
            );
        end if;

        -- Valida se o novo contato pertence ao mesmo workspace e é ativo
        if not exists (
            select 1
            from public.contacts
            where id = p_contact_id
              and workspace_id = v_workspace_id
              and operational_status = 'active'
        ) then
            raise exception 'contact_invalid'
                using errcode = '22023';
        end if;
    end if;

    -- Valida etapa se fornecida
    if p_stage_id is not null and p_stage_id <> v_current_stage_id then
        if not exists (
            select 1
            from public.pipeline_stages
            where id = p_stage_id
              and workspace_id = v_workspace_id
              and is_active = true
        ) then
            raise exception 'stage_invalid'
                using errcode = '22023';
        end if;
    end if;

    -- Valida responsável se fornecido
    if p_responsible_member_id is not null then
        if not exists (
            select 1
            from public.workspace_members
            where id = p_responsible_member_id
              and workspace_id = v_workspace_id
              and status = 'active'
        ) then
            raise exception 'responsible_member_invalid'
                using errcode = '22023';
        end if;
    end if;

    -- Se a etapa mudou, registrar em pipeline_history
    if p_stage_id is not null and p_stage_id <> v_current_stage_id then
        insert into public.pipeline_history (
            workspace_id,
            opportunity_id,
            previous_stage_id,
            new_stage_id,
            changed_by_member_id,
            reason,
            changed_at
        )
        values (
            v_workspace_id,
            p_opportunity_id,
            v_current_stage_id,
            p_stage_id,
            v_member_id,
            'Edição de Oportunidade',
            v_occurred_at
        );
    end if;

    -- Atualiza oportunidade
    update public.opportunities
    set title = v_new_title,
        description = v_new_description,
        current_stage_id = coalesce(p_stage_id, current_stage_id),
        contact_id = coalesce(p_contact_id, contact_id),
        responsible_member_id = p_responsible_member_id,
        updated_at = v_occurred_at
    where id = p_opportunity_id
      and workspace_id = v_workspace_id;

    -- Auditoria
    insert into public.audit_events (
        workspace_id,
        actor_type,
        actor_member_id,
        action,
        target_type,
        target_id,
        result,
        metadata,
        occurred_at,
        recorded_at
    )
    values (
        v_workspace_id,
        'member',
        v_member_id,
        'opportunity.updated',
        'opportunity',
        p_opportunity_id,
        'success',
        jsonb_build_object(
            'previous_title', v_current_title,
            'new_title', v_new_title,
            'stage_id', coalesce(p_stage_id, v_current_stage_id)
        ),
        v_occurred_at,
        v_occurred_at
    );

    return jsonb_build_object(
        'status', 'success',
        'opportunity_id', p_opportunity_id
    );
end;
$function$;

alter function public.update_opportunity(uuid, text, text, uuid, uuid, uuid) owner to postgres;
revoke all privileges on function public.update_opportunity(uuid, text, text, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.update_opportunity(uuid, text, text, uuid, uuid, uuid) to authenticated;


-- ─── 3. RPC public.archive_opportunity ──────────────────────────────────────

create or replace function public.archive_opportunity(
    p_opportunity_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
    v_context_count bigint;
    v_workspace_id uuid;
    v_member_id uuid;
    v_member_role text;
    v_current_title text;
    v_occurred_at timestamptz := pg_catalog.statement_timestamp();
begin
    select count(*)
    into v_context_count
    from private.active_owner_context();

    if v_context_count <> 1 then
        raise exception 'opportunity_operation_not_authorized'
            using errcode = '42501';
    end if;

    select workspace_id, member_id
    into v_workspace_id, v_member_id
    from private.active_owner_context();

    -- Garante que o operador possui papel de OWNER
    select role into v_member_role
    from public.workspace_members
    where id = v_member_id
      and workspace_id = v_workspace_id;

    if v_member_role <> 'owner' then
        raise exception 'only_owner_can_archive_opportunity'
            using errcode = '42501';
    end if;

    -- Trava e recupera a oportunidade
    select title
    into v_current_title
    from public.opportunities
    where id = p_opportunity_id
      and workspace_id = v_workspace_id
      and archived_at is null
    for update;

    if v_current_title is null then
        raise exception 'opportunity_not_found_or_already_archived'
            using errcode = '42704';
    end if;

    -- Executa arquivamento lógico preservando o registro e relações
    update public.opportunities
    set archived_at = v_occurred_at,
        updated_at = v_occurred_at
    where id = p_opportunity_id
      and workspace_id = v_workspace_id;

    -- Auditoria
    insert into public.audit_events (
        workspace_id,
        actor_type,
        actor_member_id,
        action,
        target_type,
        target_id,
        result,
        metadata,
        occurred_at,
        recorded_at
    )
    values (
        v_workspace_id,
        'member',
        v_member_id,
        'opportunity.archived',
        'opportunity',
        p_opportunity_id,
        'success',
        jsonb_build_object('title', v_current_title),
        v_occurred_at,
        v_occurred_at
    );

    return jsonb_build_object(
        'status', 'success',
        'opportunity_id', p_opportunity_id
    );
end;
$function$;

alter function public.archive_opportunity(uuid) owner to postgres;
revoke all privileges on function public.archive_opportunity(uuid) from public, anon, authenticated;
grant execute on function public.archive_opportunity(uuid) to authenticated;


-- ─── 4. RPC public.get_or_create_opportunity_conversation ───────────────────

create or replace function public.get_or_create_opportunity_conversation(
    p_opportunity_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
    v_context_count bigint;
    v_workspace_id uuid;
    v_member_id uuid;
    v_contact_id uuid;
    v_conversation_id uuid;
    v_contact_point_id uuid;
    v_phone text;
    v_channel_connection_id uuid;
    v_occurred_at timestamptz := pg_catalog.statement_timestamp();
begin
    select count(*)
    into v_context_count
    from private.active_owner_context();

    if v_context_count <> 1 then
        raise exception 'opportunity_operation_not_authorized'
            using errcode = '42501';
    end if;

    select workspace_id, member_id
    into v_workspace_id, v_member_id
    from private.active_owner_context();

    -- Obter contact_id da oportunidade
    select contact_id
    into v_contact_id
    from public.opportunities
    where id = p_opportunity_id
      and workspace_id = v_workspace_id
      and archived_at is null;

    if v_contact_id is null then
        raise exception 'opportunity_not_found'
            using errcode = '42704';
    end if;

    -- PASSO A: Se já houver vínculo ativo em opportunity_conversations, retornar
    select conversation_id
    into v_conversation_id
    from public.opportunity_conversations
    where workspace_id = v_workspace_id
      and opportunity_id = p_opportunity_id
      and unlinked_at is null
    limit 1;

    if v_conversation_id is not null then
        return jsonb_build_object(
            'status', 'success',
            'conversation_id', v_conversation_id
        );
    end if;

    -- PASSO B: Localizar conversa individual existente associada ao contato no WhatsApp ativo
    select cp.conversation_id
    into v_conversation_id
    from public.conversation_participants cp
    join public.contact_points pts
      on pts.id = cp.contact_point_id
     and pts.workspace_id = cp.workspace_id
    join public.conversations c
      on c.id = cp.conversation_id
     and c.workspace_id = cp.workspace_id
    where pts.workspace_id = v_workspace_id
      and pts.contact_id = v_contact_id
      and pts.point_type = 'phone'
      and c.operational_status = 'active'
    order by c.started_at desc, c.id desc
    limit 1;

    if v_conversation_id is not null then
        -- Cria apenas o vínculo em opportunity_conversations
        insert into public.opportunity_conversations (
            workspace_id,
            opportunity_id,
            conversation_id,
            linked_by_member_id,
            linked_at
        ) values (
            v_workspace_id,
            p_opportunity_id,
            v_conversation_id,
            v_member_id,
            v_occurred_at
        );

        return jsonb_build_object(
            'status', 'linked',
            'conversation_id', v_conversation_id
        );
    end if;

    -- PASSO C: Verificar se há dados suficientes para criar nova conversa
    -- 1. Ponto de contato WhatsApp ativo
    select id, normalized_value
    into v_contact_point_id, v_phone
    from public.contact_points
    where workspace_id = v_workspace_id
      and contact_id = v_contact_id
      and point_type = 'phone'
      and operational_status = 'active'
    order by is_protected desc, created_at asc
    limit 1;

    -- 2. Conexão do canal WhatsApp ativa
    select id
    into v_channel_connection_id
    from public.channel_connections
    where workspace_id = v_workspace_id
      and provider = 'whatsapp'
      and status = 'active'
    limit 1;

    -- PASSO D: Se não houver dados suficientes, falha graciosamente sem NENHUMA escrita
    if v_contact_point_id is null or v_channel_connection_id is null then
        return jsonb_build_object(
            'status', 'NO_ELIGIBLE_CONVERSATION',
            'error', 'Contato não possui telefone WhatsApp ativo ou canal desacoplado.'
        );
    end if;

    -- Criar conversa, participante e vínculo atomicamente
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
        v_phone || '@s.whatsapp.net',
        'individual',
        'active',
        'commercial',
        v_occurred_at
    ) returning id into v_conversation_id;

    insert into public.conversation_participants (
        workspace_id,
        conversation_id,
        contact_point_id,
        first_seen_at
    ) values (
        v_workspace_id,
        v_conversation_id,
        v_contact_point_id,
        v_occurred_at
    );

    insert into public.opportunity_conversations (
        workspace_id,
        opportunity_id,
        conversation_id,
        linked_by_member_id,
        linked_at
    ) values (
        v_workspace_id,
        p_opportunity_id,
        v_conversation_id,
        v_member_id,
        v_occurred_at
    );

    -- Auditoria
    insert into public.audit_events (
        workspace_id,
        actor_type,
        actor_member_id,
        action,
        target_type,
        target_id,
        result,
        metadata,
        occurred_at,
        recorded_at
    ) values (
        v_workspace_id,
        'member',
        v_member_id,
        'conversation.created_for_opportunity',
        'conversation',
        v_conversation_id,
        'success',
        jsonb_build_object('opportunity_id', p_opportunity_id),
        v_occurred_at,
        v_occurred_at
    );

    return jsonb_build_object(
        'status', 'created',
        'conversation_id', v_conversation_id
    );
end;
$function$;

alter function public.get_or_create_opportunity_conversation(uuid) owner to postgres;
revoke all privileges on function public.get_or_create_opportunity_conversation(uuid) from public, anon, authenticated;
grant execute on function public.get_or_create_opportunity_conversation(uuid) to authenticated;


-- ─── 5. RPC public.link_opportunity_conversation ───────────────────────────

create or replace function public.link_opportunity_conversation(
    p_opportunity_id uuid,
    p_conversation_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
    v_context_count bigint;
    v_workspace_id uuid;
    v_member_id uuid;
    v_existing_id uuid;
    v_occurred_at timestamptz := pg_catalog.statement_timestamp();
begin
    select count(*)
    into v_context_count
    from private.active_owner_context();

    if v_context_count <> 1 then
        raise exception 'opportunity_operation_not_authorized'
            using errcode = '42501';
    end if;

    select workspace_id, member_id
    into v_workspace_id, v_member_id
    from private.active_owner_context();

    -- Validar que oportunidade e conversa pertencem ao mesmo workspace
    if not exists (
        select 1 from public.opportunities
        where id = p_opportunity_id and workspace_id = v_workspace_id and archived_at is null
    ) or not exists (
        select 1 from public.conversations
        where id = p_conversation_id and workspace_id = v_workspace_id and operational_status = 'active'
    ) then
        raise exception 'invalid_opportunity_or_conversation'
            using errcode = '22023';
    end if;

    -- Verificar se já existe vínculo ativo
    select id into v_existing_id
    from public.opportunity_conversations
    where workspace_id = v_workspace_id
      and opportunity_id = p_opportunity_id
      and conversation_id = p_conversation_id
      and unlinked_at is null;

    if v_existing_id is not null then
        return jsonb_build_object('status', 'already_linked');
    end if;

    insert into public.opportunity_conversations (
        workspace_id,
        opportunity_id,
        conversation_id,
        linked_by_member_id,
        linked_at
    ) values (
        v_workspace_id,
        p_opportunity_id,
        p_conversation_id,
        v_member_id,
        v_occurred_at
    );

    return jsonb_build_object('status', 'success');
end;
$function$;

alter function public.link_opportunity_conversation(uuid, uuid) owner to postgres;
revoke all privileges on function public.link_opportunity_conversation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.link_opportunity_conversation(uuid, uuid) to authenticated;


-- ─── 6. RPC public.get_opportunity_for_conversation ────────────────────────

create or replace function public.get_opportunity_for_conversation(
    p_conversation_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
    v_res jsonb;
begin
    select jsonb_build_object(
        'opportunity_id', o.id,
        'title', o.title,
        'current_stage_id', o.current_stage_id,
        'contact_id', o.contact_id,
        'status', o.status
    )
    into v_res
    from public.opportunity_conversations oc
    join public.opportunities o on o.id = oc.opportunity_id
    where oc.conversation_id = p_conversation_id
      and oc.unlinked_at is null
      and o.archived_at is null
    order by oc.linked_at desc
    limit 1;

    return v_res;
end;
$function$;

alter function public.get_opportunity_for_conversation(uuid) owner to postgres;
revoke all privileges on function public.get_opportunity_for_conversation(uuid) from public, anon, authenticated;
grant execute on function public.get_opportunity_for_conversation(uuid) to authenticated;
