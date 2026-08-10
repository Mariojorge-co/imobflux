-- ImobFlux Sprint 21: Pipeline stages provisioning and opportunity RPCs (Creation, Edition, Rework, Closure, Reactivation).

-- 1. Atualizar a função public.provision_default_pipeline_stages para as 6 etapas oficiais do Kanban

create or replace function public.provision_default_pipeline_stages(p_workspace_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $function$
declare
    v_inserted_count integer := 0;
begin
    if p_workspace_id is null then
        raise exception 'Workspace ID is required'
            using errcode = '22004';
    end if;

    -- Idempotência: Se o workspace já possui qualquer etapa ativa, não duplica
    if exists (
        select 1
        from public.pipeline_stages
        where workspace_id = p_workspace_id
          and is_active = true
    ) then
        return 0;
    end if;

    insert into public.pipeline_stages (
        workspace_id,
        name,
        position,
        is_active,
        commercial_meaning
    )
    values
        (p_workspace_id, 'Em atendimento', 1, true, 'qualification'),
        (p_workspace_id, 'Simulação / Análise', 2, true, 'analysis'),
        (p_workspace_id, 'Documentação', 3, true, 'documentation'),
        (p_workspace_id, 'Aprovado / Escolhendo imóvel', 4, true, 'selection'),
        (p_workspace_id, 'Negociação', 5, true, 'negotiation'),
        (p_workspace_id, 'Contrato', 6, true, 'contract')
    on conflict (workspace_id, position) where is_active do nothing;

    get diagnostics v_inserted_count = row_count;
    return v_inserted_count;
end;
$function$;

revoke execute on function public.provision_default_pipeline_stages(uuid) from public, anon, authenticated;
grant execute on function public.provision_default_pipeline_stages(uuid) to service_role;


-- 2. Atualizar public.create_opportunity com suporte a parâmetros de qualificação e origem

drop function if exists public.create_opportunity(
    uuid,
    uuid,
    text,
    text,
    uuid
);

create or replace function public.create_opportunity(
    p_contact_id uuid,
    p_stage_id uuid,
    p_title text,
    p_description text default null,
    p_responsible_member_id uuid default null,
    p_origin text default null,
    p_property_summary text default null,
    p_operation_type text default null,
    p_property_type_preference text default null,
    p_city_region_preference text default null,
    p_value_range_preference text default null,
    p_down_payment_available numeric default null,
    p_timeframe_intent text default null,
    p_preferences_notes text default null
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
    v_stage_position integer;
    v_clean_title text;
    v_clean_origin text;
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

    -- Validação do contato ativo no workspace
    if not exists (
        select 1
        from public.contacts
        where id = p_contact_id
          and workspace_id = v_workspace_id
          and operational_status = 'active'
    ) then
        raise exception 'contact_not_found_or_inactive'
            using errcode = '22023';
    end if;

    -- Validação da etapa ativa no workspace
    select position
    into v_stage_position
    from public.pipeline_stages
    where id = p_stage_id
      and workspace_id = v_workspace_id
      and is_active = true;

    if v_stage_position is null then
        raise exception 'stage_not_found_or_inactive'
            using errcode = '22023';
    end if;

    -- Validação do título
    v_clean_title := pg_catalog.btrim(p_title);
    if v_clean_title is null or v_clean_title = '' then
        raise exception 'opportunity_title_invalid'
            using errcode = '22023';
    end if;

    -- Normalização da origem
    v_clean_origin := pg_catalog.btrim(p_origin);
    if v_clean_origin = '' then
        v_clean_origin := null;
    end if;

    -- Validação do responsável se fornecido
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

    -- Inserção da Oportunidade
    insert into public.opportunities (
        workspace_id,
        contact_id,
        current_stage_id,
        responsible_member_id,
        title,
        description,
        status,
        origin,
        property_summary,
        operation_type,
        property_type_preference,
        city_region_preference,
        value_range_preference,
        down_payment_available,
        timeframe_intent,
        preferences_notes,
        created_at,
        updated_at
    )
    values (
        v_workspace_id,
        p_contact_id,
        p_stage_id,
        p_responsible_member_id,
        v_clean_title,
        pg_catalog.btrim(p_description),
        'open',
        v_clean_origin,
        pg_catalog.btrim(p_property_summary),
        pg_catalog.btrim(p_operation_type),
        pg_catalog.btrim(p_property_type_preference),
        pg_catalog.btrim(p_city_region_preference),
        pg_catalog.btrim(p_value_range_preference),
        p_down_payment_available,
        pg_catalog.btrim(p_timeframe_intent),
        pg_catalog.btrim(p_preferences_notes),
        v_occurred_at,
        v_occurred_at
    )
    returning id into v_opportunity_id;

    -- Histórico inicial do pipeline
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
        'Criação da Oportunidade',
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
            'title', v_clean_title,
            'stage_id', p_stage_id,
            'contact_id', p_contact_id,
            'origin', v_clean_origin
        ),
        v_occurred_at,
        v_occurred_at
    );

    return v_opportunity_id;
end;
$function$;

alter function public.create_opportunity(uuid, uuid, text, text, uuid, text, text, text, text, text, text, numeric, text, text) owner to postgres;
revoke all privileges on function public.create_opportunity(uuid, uuid, text, text, uuid, text, text, text, text, text, text, numeric, text, text) from public, anon, authenticated;
grant execute on function public.create_opportunity(uuid, uuid, text, text, uuid, text, text, text, text, text, text, numeric, text, text) to authenticated;


-- 3. RPC public.set_opportunity_rework (Transiciona para Retrabalho)

create or replace function public.set_opportunity_rework(
    p_opportunity_id uuid,
    p_rework_reason text,
    p_rework_reevaluation_date timestamptz
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
    v_current_status text;
    v_clean_reason text;
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

    v_clean_reason := pg_catalog.btrim(p_rework_reason);
    if v_clean_reason is null or v_clean_reason = '' then
        raise exception 'rework_reason_required'
            using errcode = '22023';
    end if;

    select status
    into v_current_status
    from public.opportunities
    where id = p_opportunity_id
      and workspace_id = v_workspace_id
      and archived_at is null
    for update;

    if v_current_status is null then
        raise exception 'opportunity_not_found'
            using errcode = '42704';
    end if;

    if v_current_status <> 'open' then
        raise exception 'opportunity_not_open'
            using errcode = '55000';
    end if;

    update public.opportunities
    set status = 'rework',
        rework_reason = v_clean_reason,
        rework_reevaluation_date = p_rework_reevaluation_date,
        updated_at = v_occurred_at
    where id = p_opportunity_id
      and workspace_id = v_workspace_id;

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
        'opportunity.rework_set',
        'opportunity',
        p_opportunity_id,
        'success',
        jsonb_build_object(
            'rework_reason', v_clean_reason,
            'reevaluation_date', p_rework_reevaluation_date
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

alter function public.set_opportunity_rework(uuid, text, timestamptz) owner to postgres;
revoke all privileges on function public.set_opportunity_rework(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.set_opportunity_rework(uuid, text, timestamptz) to authenticated;


-- 4. RPC public.reactivate_opportunity (Retorna de Retrabalho para Kanban Ativo)

create or replace function public.reactivate_opportunity(
    p_opportunity_id uuid,
    p_target_stage_id uuid default null
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
    v_current_status text;
    v_current_stage_id uuid;
    v_final_stage_id uuid;
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

    select status, current_stage_id
    into v_current_status, v_current_stage_id
    from public.opportunities
    where id = p_opportunity_id
      and workspace_id = v_workspace_id
      and archived_at is null
    for update;

    if v_current_status is null then
        raise exception 'opportunity_not_found'
            using errcode = '42704';
    end if;

    if v_current_status <> 'rework' then
        raise exception 'opportunity_not_in_rework'
            using errcode = '55000';
    end if;

    v_final_stage_id := coalesce(p_target_stage_id, v_current_stage_id);

    -- Valida que a etapa final é ativa no workspace
    if not exists (
        select 1
        from public.pipeline_stages
        where id = v_final_stage_id
          and workspace_id = v_workspace_id
          and is_active = true
    ) then
        raise exception 'stage_not_found_or_inactive'
            using errcode = '22023';
    end if;

    if v_final_stage_id <> v_current_stage_id then
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
            v_final_stage_id,
            v_member_id,
            'Reativação de Retrabalho',
            v_occurred_at
        );
    end if;

    update public.opportunities
    set status = 'open',
        current_stage_id = v_final_stage_id,
        rework_reason = null,
        rework_reevaluation_date = null,
        updated_at = v_occurred_at
    where id = p_opportunity_id
      and workspace_id = v_workspace_id;

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
        'opportunity.reactivated',
        'opportunity',
        p_opportunity_id,
        'success',
        jsonb_build_object('stage_id', v_final_stage_id),
        v_occurred_at,
        v_occurred_at
    );

    return jsonb_build_object(
        'status', 'success',
        'opportunity_id', p_opportunity_id
    );
end;
$function$;

alter function public.reactivate_opportunity(uuid, uuid) owner to postgres;
revoke all privileges on function public.reactivate_opportunity(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reactivate_opportunity(uuid, uuid) to authenticated;


-- 5. RPC public.close_opportunity_won (Fecha como Ganha e grava financeiros OWNER-only)

create or replace function public.close_opportunity_won(
    p_opportunity_id uuid,
    p_business_value numeric default null,
    p_commission_expected numeric default null,
    p_commission_received numeric default null
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
    v_current_status text;
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

    select role into v_member_role
    from public.workspace_members
    where id = v_member_id
      and workspace_id = v_workspace_id;

    -- Se foram passados valores financeiros e o usuário NÃO é OWNER, rejeita
    if (p_business_value is not null or p_commission_expected is not null or p_commission_received is not null)
       and v_member_role <> 'owner' then
        raise exception 'only_owner_can_manage_commissions'
            using errcode = '42501';
    end if;

    select status
    into v_current_status
    from public.opportunities
    where id = p_opportunity_id
      and workspace_id = v_workspace_id
      and archived_at is null
    for update;

    if v_current_status is null then
        raise exception 'opportunity_not_found'
            using errcode = '42704';
    end if;

    if v_current_status not in ('open', 'rework') then
        raise exception 'opportunity_already_closed'
            using errcode = '55000';
    end if;

    update public.opportunities
    set status = 'won',
        closed_at = v_occurred_at,
        updated_at = v_occurred_at
    where id = p_opportunity_id
      and workspace_id = v_workspace_id;

    -- Gravação na tabela isolada RLS opportunity_financials se for OWNER e houver valores
    if v_member_role = 'owner' and (p_business_value is not null or p_commission_expected is not null or p_commission_received is not null) then
        insert into public.opportunity_financials (
            workspace_id,
            opportunity_id,
            business_value,
            commission_expected,
            commission_received,
            created_at,
            updated_at
        )
        values (
            v_workspace_id,
            p_opportunity_id,
            p_business_value,
            p_commission_expected,
            p_commission_received,
            v_occurred_at,
            v_occurred_at
        )
        on conflict (workspace_id, opportunity_id) do update
        set business_value = coalesce(excluded.business_value, public.opportunity_financials.business_value),
            commission_expected = coalesce(excluded.commission_expected, public.opportunity_financials.commission_expected),
            commission_received = coalesce(excluded.commission_received, public.opportunity_financials.commission_received),
            updated_at = v_occurred_at;
    end if;

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
        'opportunity.won',
        'opportunity',
        p_opportunity_id,
        'success',
        jsonb_build_object('closed_at', v_occurred_at),
        v_occurred_at,
        v_occurred_at
    );

    return jsonb_build_object(
        'status', 'success',
        'opportunity_id', p_opportunity_id
    );
end;
$function$;

alter function public.close_opportunity_won(uuid, numeric, numeric, numeric) owner to postgres;
revoke all privileges on function public.close_opportunity_won(uuid, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function public.close_opportunity_won(uuid, numeric, numeric, numeric) to authenticated;


-- 6. RPC public.close_opportunity_lost (Fecha como Perdida exigindo motivo)

create or replace function public.close_opportunity_lost(
    p_opportunity_id uuid,
    p_loss_reason text,
    p_loss_notes text default null
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
    v_current_status text;
    v_clean_reason text;
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

    v_clean_reason := pg_catalog.btrim(p_loss_reason);
    if v_clean_reason is null or v_clean_reason = '' then
        raise exception 'loss_reason_required'
            using errcode = '22023';
    end if;

    select status
    into v_current_status
    from public.opportunities
    where id = p_opportunity_id
      and workspace_id = v_workspace_id
      and archived_at is null
    for update;

    if v_current_status is null then
        raise exception 'opportunity_not_found'
            using errcode = '42704';
    end if;

    if v_current_status not in ('open', 'rework') then
        raise exception 'opportunity_already_closed'
            using errcode = '55000';
    end if;

    update public.opportunities
    set status = 'lost',
        closed_at = v_occurred_at,
        loss_reason = v_clean_reason,
        loss_notes = pg_catalog.btrim(p_loss_notes),
        updated_at = v_occurred_at
    where id = p_opportunity_id
      and workspace_id = v_workspace_id;

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
        'opportunity.lost',
        'opportunity',
        p_opportunity_id,
        'success',
        jsonb_build_object(
            'loss_reason', v_clean_reason,
            'closed_at', v_occurred_at
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

alter function public.close_opportunity_lost(uuid, text, text) owner to postgres;
revoke all privileges on function public.close_opportunity_lost(uuid, text, text) from public, anon, authenticated;
grant execute on function public.close_opportunity_lost(uuid, text, text) to authenticated;


-- 7. RPC public.close_opportunity_cancelled (Fecha como Cancelada)

create or replace function public.close_opportunity_cancelled(
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
    v_current_status text;
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

    select status
    into v_current_status
    from public.opportunities
    where id = p_opportunity_id
      and workspace_id = v_workspace_id
      and archived_at is null
    for update;

    if v_current_status is null then
        raise exception 'opportunity_not_found'
            using errcode = '42704';
    end if;

    if v_current_status not in ('open', 'rework') then
        raise exception 'opportunity_already_closed'
            using errcode = '55000';
    end if;

    update public.opportunities
    set status = 'cancelled',
        closed_at = v_occurred_at,
        updated_at = v_occurred_at
    where id = p_opportunity_id
      and workspace_id = v_workspace_id;

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
        'opportunity.cancelled',
        'opportunity',
        p_opportunity_id,
        'success',
        jsonb_build_object('closed_at', v_occurred_at),
        v_occurred_at,
        v_occurred_at
    );

    return jsonb_build_object(
        'status', 'success',
        'opportunity_id', p_opportunity_id
    );
end;
$function$;

alter function public.close_opportunity_cancelled(uuid) owner to postgres;
revoke all privileges on function public.close_opportunity_cancelled(uuid) from public, anon, authenticated;
grant execute on function public.close_opportunity_cancelled(uuid) to authenticated;


-- 8. Atualizar public.get_kanban_board para incluir novos metadados sem expor financeiros privados

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
            o.origin,
            o.property_summary,
            o.operation_type,
            o.property_type_preference,
            o.city_region_preference,
            o.value_range_preference,
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
                    'origin', ro.origin,
                    'property_summary', ro.property_summary,
                    'operation_type', ro.operation_type,
                    'property_type_preference', ro.property_type_preference,
                    'city_region_preference', ro.city_region_preference,
                    'value_range_preference', ro.value_range_preference,
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
