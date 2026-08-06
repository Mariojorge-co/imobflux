-- ImobFlux Sprint 18: Kanban Operations, Batch Board Query, Stage Movement with Concurrency Control & Audit.

revoke insert, update, delete, truncate, references, trigger on table
    public.opportunities,
    public.pipeline_stages,
    public.pipeline_history,
    public.audit_events
from authenticated;

grant select on table
    public.opportunities,
    public.pipeline_stages,
    public.pipeline_history,
    public.audit_events
to authenticated;

-- ============================================================================
-- 1. RPC DE LEITURA EM LOTE: get_kanban_board
-- ============================================================================
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
                    'responsible_name', ro.responsible_name
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

-- ============================================================================
-- 2. RPC DE MOVIMENTAÇÃO DE ETAPA COM CONCORRÊNCIA: move_opportunity_stage
-- ============================================================================
create or replace function public.move_opportunity_stage(
    p_opportunity_id uuid,
    p_expected_current_stage_id uuid,
    p_new_stage_id uuid,
    p_reason text default null
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
    v_actual_stage_id uuid;
    v_opp_status text;
    v_opp_archived_at timestamptz;
    v_reason text;
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

    if p_opportunity_id is null or p_expected_current_stage_id is null or p_new_stage_id is null then
        raise exception 'opportunity_invalid_arguments'
            using errcode = '22023';
    end if;

    -- Bloqueia a oportunidade transacionalmente para verificação segura
    select current_stage_id, status, archived_at
    into v_actual_stage_id, v_opp_status, v_opp_archived_at
    from public.opportunities
    where id = p_opportunity_id
      and workspace_id = v_workspace_id
    for update;

    if v_actual_stage_id is null then
        raise exception 'opportunity_not_found'
            using errcode = '22023';
    end if;

    if v_opp_status <> 'open' or v_opp_archived_at is not null then
        raise exception 'opportunity_not_open'
            using errcode = '22023';
    end if;

    -- 1. Detecção de Conflito de Concorrência: o estágio atual no banco é diferente do observado pelo cliente
    if v_actual_stage_id <> p_expected_current_stage_id then
        return jsonb_build_object(
            'status', 'conflict',
            'message', 'A oportunidade foi alterada por outra operação.',
            'actual_stage_id', v_actual_stage_id
        );
    end if;

    -- 2. Idempotência: se a nova etapa for exatamente a atual, retorna no_change sem alterar nada
    if p_expected_current_stage_id = p_new_stage_id then
        return jsonb_build_object(
            'status', 'no_change',
            'opportunity_id', p_opportunity_id,
            'stage_id', p_new_stage_id
        );
    end if;

    -- 3. Valida se a etapa de destino pertence ao mesmo workspace e está ativa
    if not exists (
        select 1
        from public.pipeline_stages
        where id = p_new_stage_id
          and workspace_id = v_workspace_id
          and is_active = true
    ) then
        raise exception 'target_stage_invalid'
            using errcode = '22023';
    end if;

    v_reason := pg_catalog.btrim(p_reason);
    if v_reason = '' then
        v_reason := null;
    end if;

    -- Atualiza a oportunidade
    update public.opportunities
    set current_stage_id = p_new_stage_id,
        updated_at = pg_catalog.now()
    where id = p_opportunity_id
      and workspace_id = v_workspace_id;

    -- Insere histórico
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
        p_expected_current_stage_id,
        p_new_stage_id,
        v_member_id,
        v_reason,
        v_occurred_at
    );

    -- Insere evento de auditoria
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
        'opportunity.stage_changed',
        'opportunity',
        p_opportunity_id,
        'success',
        jsonb_build_object(
            'previous_stage_id', p_expected_current_stage_id,
            'new_stage_id', p_new_stage_id,
            'reason', v_reason
        ),
        v_occurred_at,
        v_occurred_at
    );

    return jsonb_build_object(
        'status', 'success',
        'opportunity_id', p_opportunity_id,
        'previous_stage_id', p_expected_current_stage_id,
        'new_stage_id', p_new_stage_id
    );
end;
$function$;

revoke all privileges on function public.move_opportunity_stage(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.move_opportunity_stage(uuid, uuid, uuid, text) to authenticated;

-- ============================================================================
-- 3. RPC DE CRIAÇÃO DE OPORTUNIDADE: create_opportunity
-- ============================================================================
create or replace function public.create_opportunity(
    p_contact_id uuid,
    p_stage_id uuid,
    p_title text,
    p_description text default null,
    p_responsible_member_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
    v_context_count bigint;
    v_workspace_id uuid;
    v_member_id uuid;
    v_opportunity_id uuid;
    v_title text;
    v_description text;
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

    v_title := pg_catalog.btrim(p_title);
    if v_title is null or v_title = '' then
        raise exception 'opportunity_title_invalid'
            using errcode = '22023';
    end if;

    v_description := pg_catalog.btrim(p_description);
    if v_description = '' then
        v_description := null;
    end if;

    -- Valida se o contato pertence ao mesmo workspace e é ativo
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

    -- Valida se a etapa pertence ao mesmo workspace e está ativa
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

    -- Valida se o responsável (se fornecido) pertence ao mesmo workspace e é ativo
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

    -- Insere oportunidade
    insert into public.opportunities (
        workspace_id,
        contact_id,
        current_stage_id,
        responsible_member_id,
        title,
        description,
        status
    )
    values (
        v_workspace_id,
        p_contact_id,
        p_stage_id,
        p_responsible_member_id,
        v_title,
        v_description,
        'open'
    )
    returning id into v_opportunity_id;

    -- Histórico inicial
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
        v_opportunity_id,
        null,
        p_stage_id,
        v_member_id,
        'Criação de Oportunidade',
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
    )
    values (
        v_workspace_id,
        'member',
        v_member_id,
        'opportunity.created',
        'opportunity',
        v_opportunity_id,
        'success',
        jsonb_build_object(
            'title', v_title,
            'stage_id', p_stage_id,
            'contact_id', p_contact_id
        ),
        v_occurred_at,
        v_occurred_at
    );

    return v_opportunity_id;
end;
$function$;

revoke all privileges on function public.create_opportunity(uuid, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.create_opportunity(uuid, uuid, text, text, uuid) to authenticated;
