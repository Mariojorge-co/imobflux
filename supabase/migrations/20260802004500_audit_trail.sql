-- ImobFlux: trilha de auditoria (FLUXOS_NEGOCIO.md, fluxo 25).
--
-- 1) Duas operações que alteravam dados comerciais sem deixar rastro passam a auditar, sempre sem
--    copiar conteúdo (só ids e nomes de campos):
--      * link_opportunity_conversation    -> opportunity.conversation_linked
--      * update_contact_opportunity_qualification -> opportunity.qualification_updated / contact.qualification_updated
--    (remoção de funcionário, atribuição de conversa, mudança de etapa, arquivamentos e encerramentos
--    já eram auditados.)
-- 2) get_audit_events: consulta exclusiva do OWNER, com filtros (categoria, pessoa, período) e paginação
--    por cursor. A tabela já é append-only (triggers) e legível só pelo OWNER pela RLS; esta função
--    acrescenta o nome de quem agiu. Consultar a auditoria não gera evento.

create or replace function public.link_opportunity_conversation(p_opportunity_id uuid, p_conversation_id uuid)
returns jsonb
language plpgsql
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

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type,
        target_id, result, metadata, occurred_at, recorded_at
    ) values (
        v_workspace_id, 'member', v_member_id, 'opportunity.conversation_linked', 'opportunity',
        p_opportunity_id, 'success', pg_catalog.jsonb_build_object('conversation_id', p_conversation_id),
        v_occurred_at, v_occurred_at
    );

    return jsonb_build_object('status', 'success');
end;
$function$;

create or replace function public.update_contact_opportunity_qualification(
    p_contact_id uuid,
    p_opportunity_id uuid default null,
    p_operation_type text default null,
    p_property_type_preference text default null,
    p_city_region_preference text default null,
    p_max_price_budget numeric default null,
    p_available_down_payment numeric default null,
    p_timeframe_intent text default null,
    p_family_income numeric default null,
    p_financial_analysis_status text default null,
    p_approved_credit_amount numeric default null,
    p_docs_status text default null,
    p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_context record;
    v_fields text[];
    v_now timestamptz := pg_catalog.statement_timestamp();
begin
    select * into v_context from private.active_member_context() limit 1;
    if v_context.member_id is null or not private.can_access_contact(p_contact_id)
       or (p_opportunity_id is not null and (
           not private.can_access_opportunity(p_opportunity_id)
           or not exists (select 1 from public.opportunities where id = p_opportunity_id
                          and contact_id = p_contact_id and workspace_id = v_context.workspace_id)
       )) then
        raise exception 'resource_not_available' using errcode = '42501';
    end if;

    update public.contacts set registration_status = 'confirmed', updated_at = statement_timestamp()
    where id = p_contact_id and workspace_id = v_context.workspace_id;

    if p_opportunity_id is not null then
        update public.opportunities set
            operation_type = coalesce(p_operation_type, operation_type),
            property_type_preference = coalesce(p_property_type_preference, property_type_preference),
            city_region_preference = coalesce(p_city_region_preference, city_region_preference),
            value_range_preference = coalesce(p_max_price_budget::text, value_range_preference),
            down_payment_available = coalesce(p_available_down_payment, down_payment_available),
            timeframe_intent = coalesce(p_timeframe_intent, timeframe_intent),
            preferences_notes = coalesce(p_notes, preferences_notes),
            family_income = case when v_context.member_role = 'owner' then coalesce(p_family_income, family_income) else family_income end,
            financial_analysis_status = case when v_context.member_role = 'owner' then coalesce(p_financial_analysis_status, financial_analysis_status) else financial_analysis_status end,
            approved_amount = case when v_context.member_role = 'owner' then coalesce(p_approved_credit_amount, approved_amount) else approved_amount end,
            documentation_status = case when v_context.member_role = 'owner' then coalesce(p_docs_status, documentation_status) else documentation_status end,
            updated_at = statement_timestamp()
        where id = p_opportunity_id and workspace_id = v_context.workspace_id;
    end if;

    -- Só os NOMES dos campos efetivamente enviados (nunca os valores). Campos financeiros só contam para OWNER.
    v_fields := array_remove(array[
        case when p_operation_type is not null then 'operation_type' end,
        case when p_property_type_preference is not null then 'property_type_preference' end,
        case when p_city_region_preference is not null then 'city_region_preference' end,
        case when p_max_price_budget is not null then 'max_price_budget' end,
        case when p_available_down_payment is not null then 'available_down_payment' end,
        case when p_timeframe_intent is not null then 'timeframe_intent' end,
        case when p_notes is not null then 'notes' end,
        case when v_context.member_role = 'owner' and p_family_income is not null then 'family_income' end,
        case when v_context.member_role = 'owner' and p_financial_analysis_status is not null then 'financial_analysis_status' end,
        case when v_context.member_role = 'owner' and p_approved_credit_amount is not null then 'approved_credit_amount' end,
        case when v_context.member_role = 'owner' and p_docs_status is not null then 'docs_status' end
    ], null);

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type,
        target_id, result, metadata, occurred_at, recorded_at
    ) values (
        v_context.workspace_id, 'member', v_context.member_id,
        case when p_opportunity_id is not null then 'opportunity.qualification_updated' else 'contact.qualification_updated' end,
        case when p_opportunity_id is not null then 'opportunity' else 'contact' end,
        coalesce(p_opportunity_id, p_contact_id), 'success',
        pg_catalog.jsonb_build_object('fields', pg_catalog.to_jsonb(coalesce(v_fields, array[]::text[]))),
        v_now, v_now
    );

    return jsonb_build_object('success', true);
end;
$function$;

-- Consulta da auditoria (somente OWNER). Categoria = prefixo da ação (team, conversation, opportunity,
-- contact, group, task, export, whatsapp, bootstrap). Período: p_from inclusivo, p_to exclusivo.
create or replace function public.get_audit_events(
    p_category text default null,
    p_actor_member_id uuid default null,
    p_from timestamptz default null,
    p_to timestamptz default null,
    p_cursor_ts timestamptz default null,
    p_cursor_id uuid default null,
    p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
    v_workspace_id uuid;
    v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
    v_category text := nullif(pg_catalog.btrim(p_category), '');
    v_events jsonb;
    v_count integer;
begin
    select context.workspace_id
    into v_workspace_id
    from private.active_member_context() as context
    where context.member_role = 'owner';

    if v_workspace_id is null then
        raise exception 'audit_not_authorized' using errcode = '42501';
    end if;

    if v_category is not null
       and v_category not in ('team', 'conversation', 'opportunity', 'contact', 'group', 'task', 'export', 'whatsapp', 'bootstrap') then
        raise exception 'audit_invalid_filter' using errcode = '22023';
    end if;

    with page as (
        select event.*
        from public.audit_events as event
        where event.workspace_id = v_workspace_id
          and (v_category is null or event.action like v_category || '.%')
          and (p_actor_member_id is null or event.actor_member_id = p_actor_member_id)
          and (p_from is null or event.occurred_at >= p_from)
          and (p_to is null or event.occurred_at < p_to)
          and (
              p_cursor_ts is null
              or (event.occurred_at, event.id) < (p_cursor_ts, coalesce(p_cursor_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
          )
        order by event.occurred_at desc, event.id desc
        limit v_limit + 1
    ), numbered as (
        select page.*, row_number() over (order by page.occurred_at desc, page.id desc) as position
        from page
    )
    select
        coalesce(
            jsonb_agg(
                jsonb_build_object(
                    'id', numbered.id,
                    'occurred_at', numbered.occurred_at,
                    'action', numbered.action,
                    'target_type', numbered.target_type,
                    'target_id', numbered.target_id,
                    'result', numbered.result,
                    'actor_type', numbered.actor_type,
                    'actor_member_id', numbered.actor_member_id,
                    'actor_name', actor_user.display_name,
                    'metadata', numbered.metadata
                ) order by numbered.position
            ) filter (where numbered.position <= v_limit),
            '[]'::jsonb
        ),
        count(*)
    into v_events, v_count
    from numbered
    left join public.workspace_members as actor_member
      on actor_member.workspace_id = numbered.workspace_id
     and actor_member.id = numbered.actor_member_id
    left join public.app_users as actor_user
      on actor_user.id = actor_member.user_id;

    return jsonb_build_object('events', v_events, 'has_more', v_count > v_limit);
end;
$function$;

alter function public.link_opportunity_conversation(uuid, uuid) owner to postgres;
alter function public.update_contact_opportunity_qualification(uuid, uuid, text, text, text, numeric, numeric, text, numeric, text, numeric, text, text) owner to postgres;
alter function public.get_audit_events(text, uuid, timestamptz, timestamptz, timestamptz, uuid, integer) owner to postgres;
revoke all on function public.get_audit_events(text, uuid, timestamptz, timestamptz, timestamptz, uuid, integer) from public, anon, service_role;
grant execute on function public.get_audit_events(text, uuid, timestamptz, timestamptz, timestamptz, uuid, integer) to authenticated;
