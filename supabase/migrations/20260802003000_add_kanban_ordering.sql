-- Sprint 25: persistent ordering for Kanban opportunities.

create sequence if not exists public.opportunities_sort_order_seq;

alter table public.opportunities
  add column if not exists sort_order bigint not null
    default nextval('public.opportunities_sort_order_seq'::regclass);

with ranked as (
  select
    o.id,
    row_number() over (
      partition by o.workspace_id, o.current_stage_id
      order by o.updated_at desc, o.id desc
    )::bigint as new_sort_order
  from public.opportunities o
  where o.status = 'open'
    and o.archived_at is null
)
update public.opportunities o
set sort_order = ranked.new_sort_order
from ranked
where ranked.id = o.id;

select setval(
  'public.opportunities_sort_order_seq'::regclass,
  greatest(coalesce((select max(sort_order) from public.opportunities), 0), 1),
  true
);

create index if not exists idx_opportunities_kanban_order
  on public.opportunities (workspace_id, current_stage_id, status, archived_at, sort_order, id);

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
                'linked_conversation_id', ro.linked_conversation_id
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

    -- Serialize both affected columns and obtain the authoritative current stage.
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
        update public.opportunities set current_stage_id = p_target_stage_id, sort_order = v_index,
            updated_at = v_occurred_at where id = v_id and workspace_id = v_workspace_id;
    end loop;
    if v_actual_stage_id <> p_target_stage_id then
        v_index := 0;
        foreach v_id in array v_source_ids loop
            v_index := v_index + 1;
            update public.opportunities set sort_order = v_index, updated_at = v_occurred_at
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
