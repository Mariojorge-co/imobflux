-- ImobFlux Sprint 20: Automatic provisioning of default Kanban pipeline stages during workspace bootstrap.

-- 1. Permissões para o service_role ler e inserir etapas de pipeline durante o bootstrap
grant select, insert on table public.pipeline_stages to service_role;

-- 2. Função helper para provisionar as 5 etapas padrão do Kanban
create function public.provision_default_pipeline_stages(p_workspace_id uuid)
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

    -- Idempotência: Se o workspace já possui qualquer etapa, não duplica nem sobrescreve
    if exists (
        select 1
        from public.pipeline_stages
        where workspace_id = p_workspace_id
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
        (p_workspace_id, 'Novo lead', 1, true, 'prospecting'),
        (p_workspace_id, 'Em atendimento', 2, true, 'qualification'),
        (p_workspace_id, 'Em negociação', 3, true, 'negotiation'),
        (p_workspace_id, 'Documentação', 4, true, 'documentation'),
        (p_workspace_id, 'Fechamento', 5, true, 'closing')
    on conflict (workspace_id, position) where is_active do nothing;

    get diagnostics v_inserted_count = row_count;
    return v_inserted_count;
end;
$function$;

-- 3. Permissões da função helper
revoke execute on function public.provision_default_pipeline_stages(uuid) from public;
revoke execute on function public.provision_default_pipeline_stages(uuid) from anon;
revoke execute on function public.provision_default_pipeline_stages(uuid) from authenticated;
grant execute on function public.provision_default_pipeline_stages(uuid) to service_role;

-- 4. Atualização do bootstrap_initial_workspace para invocar a criação atômica das 5 etapas padrão
create or replace function public.bootstrap_initial_workspace(
    p_auth_user_id uuid,
    p_display_name text,
    p_workspace_name text,
    p_timezone text
)
returns table (
    app_user_id uuid,
    workspace_id uuid,
    workspace_member_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
    v_app_user_id uuid;
    v_workspace_id uuid;
    v_workspace_member_id uuid;
    v_occurred_at timestamptz := pg_catalog.statement_timestamp();
begin
    perform pg_catalog.pg_advisory_xact_lock(3104776296942529792::bigint);

    if exists (select 1 from public.workspaces) then
        raise exception 'Initial bootstrap is closed'
            using errcode = '55000';
    end if;

    if p_auth_user_id is null then
        raise exception 'Auth user is required'
            using errcode = '22004';
    end if;

    if p_display_name is null or pg_catalog.btrim(p_display_name) = '' then
        raise exception 'Display name is required'
            using errcode = '22023';
    end if;

    if p_workspace_name is null or pg_catalog.btrim(p_workspace_name) = '' then
        raise exception 'Workspace name is required'
            using errcode = '22023';
    end if;

    if p_timezone is null or pg_catalog.btrim(p_timezone) = '' then
        raise exception 'Timezone is required'
            using errcode = '22023';
    end if;

    insert into public.app_users (
        auth_user_id,
        display_name,
        status
    )
    values (
        p_auth_user_id,
        pg_catalog.btrim(p_display_name),
        'active'
    )
    returning id into v_app_user_id;

    insert into public.workspaces (
        name,
        status,
        timezone
    )
    values (
        pg_catalog.btrim(p_workspace_name),
        'active',
        pg_catalog.btrim(p_timezone)
    )
    returning id into v_workspace_id;

    insert into public.workspace_members (
        workspace_id,
        user_id,
        role,
        status,
        activated_at
    )
    values (
        v_workspace_id,
        v_app_user_id,
        'owner',
        'active',
        v_occurred_at
    )
    returning id into v_workspace_member_id;

    -- Provisiona atomicamente as 5 etapas padrão do Kanban para o novo workspace
    perform public.provision_default_pipeline_stages(v_workspace_id);

    insert into public.audit_events (
        workspace_id,
        actor_type,
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
        'system',
        'bootstrap.completed',
        'workspace',
        v_workspace_id,
        'success',
        pg_catalog.jsonb_build_object(
            'app_user_id', v_app_user_id,
            'workspace_member_id', v_workspace_member_id
        ),
        v_occurred_at,
        v_occurred_at
    );

    return query
    select
        v_app_user_id,
        v_workspace_id,
        v_workspace_member_id;
end;
$function$;
