-- Sprint 25 corrective migration: renumbering must not touch unrelated updated_at values.

create or replace function public.reorder_opportunity(
    p_opportunity_id uuid,
    p_expected_current_stage_id uuid,
    p_target_stage_id uuid,
    p_before_opportunity_id uuid default null
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
    v_target_ids uuid[] := '{}'::uuid[];
    v_existing_target_ids uuid[] := '{}'::uuid[];
    v_source_ids uuid[] := '{}'::uuid[];
    v_id uuid;
    v_index integer := 0;
    v_occurred_at timestamptz := pg_catalog.statement_timestamp();
begin
    select count(*) into v_context_count from private.active_owner_context();
    if v_context_count <> 1 then
        raise exception 'opportunity_operation_not_authorized' using errcode = '42501';
    end if;
    select workspace_id, member_id into v_workspace_id, v_member_id from private.active_owner_context();

    if p_opportunity_id is null or p_expected_current_stage_id is null or p_target_stage_id is null then
        raise exception 'opportunity_invalid_arguments' using errcode = '22023';
    end if;

    perform 1 from public.opportunities o
    where o.workspace_id = v_workspace_id and o.status = 'open' and o.archived_at is null
      and o.current_stage_id in (p_expected_current_stage_id, p_target_stage_id)
    order by o.current_stage_id, o.sort_order, o.id for update;

    select o.current_stage_id into v_actual_stage_id
    from public.opportunities o
    where o.id = p_opportunity_id and o.workspace_id = v_workspace_id
      and o.status = 'open' and o.archived_at is null;
    if v_actual_stage_id is null then
        raise exception 'opportunity_not_found' using errcode = '22023';
    end if;
    if v_actual_stage_id <> p_expected_current_stage_id then
        return jsonb_build_object('status', 'conflict', 'actual_stage_id', v_actual_stage_id);
    end if;

    if not exists (
        select 1 from public.pipeline_stages s
        where s.id = p_target_stage_id and s.workspace_id = v_workspace_id and s.is_active = true
    ) then
        raise exception 'target_stage_invalid' using errcode = '22023';
    end if;

    if p_before_opportunity_id is not null and (
        p_before_opportunity_id = p_opportunity_id or not exists (
            select 1 from public.opportunities o
            where o.id = p_before_opportunity_id and o.workspace_id = v_workspace_id
              and o.current_stage_id = p_target_stage_id and o.status = 'open' and o.archived_at is null
        )
    ) then
        raise exception 'invalid_insertion_point' using errcode = '22023';
    end if;

    select coalesce(array_agg(o.id order by o.sort_order, o.id), '{}'::uuid[])
    into v_target_ids
    from public.opportunities o
    where o.workspace_id = v_workspace_id and o.current_stage_id = p_target_stage_id
      and o.status = 'open' and o.archived_at is null and o.id <> p_opportunity_id;
    v_existing_target_ids := v_target_ids;

    if p_before_opportunity_id is null then
        v_target_ids := array_append(v_target_ids, p_opportunity_id);
    else
        v_target_ids := '{}'::uuid[];
        foreach v_id in array v_existing_target_ids loop
            if v_id = p_before_opportunity_id then
                v_target_ids := array_append(v_target_ids, p_opportunity_id);
            end if;
            v_target_ids := array_append(v_target_ids, v_id);
        end loop;
    end if;

    if v_actual_stage_id <> p_target_stage_id then
        select coalesce(array_agg(o.id order by o.sort_order, o.id), '{}'::uuid[])
        into v_source_ids
        from public.opportunities o
        where o.workspace_id = v_workspace_id and o.current_stage_id = v_actual_stage_id
          and o.status = 'open' and o.archived_at is null and o.id <> p_opportunity_id;
    else
        v_source_ids := v_target_ids;
    end if;

    foreach v_id in array v_target_ids loop
        v_index := v_index + 1;
        if v_id = p_opportunity_id then
            update public.opportunities
            set current_stage_id = p_target_stage_id, sort_order = v_index, updated_at = v_occurred_at
            where id = v_id and workspace_id = v_workspace_id;
        else
            update public.opportunities
            set current_stage_id = p_target_stage_id, sort_order = v_index
            where id = v_id and workspace_id = v_workspace_id;
        end if;
    end loop;

    if v_actual_stage_id <> p_target_stage_id then
        v_index := 0;
        foreach v_id in array v_source_ids loop
            v_index := v_index + 1;
            update public.opportunities
            set sort_order = v_index
            where id = v_id and workspace_id = v_workspace_id;
        end loop;
    end if;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type, target_id,
        result, metadata, occurred_at, recorded_at
    ) values (
        v_workspace_id, 'member', v_member_id, 'opportunity.reordered', 'opportunity',
        p_opportunity_id, 'success', jsonb_build_object(
            'previous_stage_id', p_expected_current_stage_id,
            'new_stage_id', p_target_stage_id,
            'before_opportunity_id', p_before_opportunity_id
        ), v_occurred_at, v_occurred_at
    );

    if v_actual_stage_id <> p_target_stage_id then
        insert into public.pipeline_history (
            workspace_id, opportunity_id, previous_stage_id, new_stage_id,
            changed_by_member_id, reason, changed_at
        ) values (
            v_workspace_id, p_opportunity_id, p_expected_current_stage_id,
            p_target_stage_id, v_member_id, 'Reordenação no Kanban', v_occurred_at
        );
    end if;

    return jsonb_build_object('status', 'success', 'opportunity_id', p_opportunity_id,
        'stage_id', p_target_stage_id, 'before_opportunity_id', p_before_opportunity_id);
end;
$function$;

alter function public.reorder_opportunity(uuid, uuid, uuid, uuid) owner to postgres;
revoke all privileges on function public.reorder_opportunity(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.reorder_opportunity(uuid, uuid, uuid, uuid) to authenticated;
