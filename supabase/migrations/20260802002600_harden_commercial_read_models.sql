-- ImobFlux: resource-scoped commercial RPCs and actionable priorities.

create or replace function public.get_conversation_context(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
    v_conversation public.conversations%rowtype;
    v_context record;
    v_contact_id uuid;
    v_contact jsonb;
    v_active_opportunity jsonb;
    v_all_opportunities jsonb := '[]'::jsonb;
    v_tasks jsonb := '[]'::jsonb;
    v_notes jsonb := '[]'::jsonb;
    v_timeline jsonb := '[]'::jsonb;
    v_financial jsonb;
begin
    select * into v_conversation
    from public.conversations
    where id = p_conversation_id;

    if v_conversation.id is null then return null; end if;

    select * into v_context
    from private.active_member_context() as context
    where context.workspace_id = v_conversation.workspace_id;
    if v_context.member_id is null then return null; end if;

    if v_conversation.conversation_type = 'group' then
        return jsonb_build_object(
            'contact', null, 'active_opportunity', null,
            'all_opportunities', '[]'::jsonb, 'financial_info', null,
            'tasks', '[]'::jsonb, 'notes', '[]'::jsonb,
            'timeline', '[]'::jsonb, 'caller_role', v_context.member_role
        );
    end if;

    select contact.id into v_contact_id
    from public.conversation_participants as participant
    join public.contact_points as point
      on point.workspace_id = participant.workspace_id
     and point.id = participant.contact_point_id
    join public.contacts as contact
      on contact.workspace_id = point.workspace_id
     and contact.id = point.contact_id
    where participant.workspace_id = v_conversation.workspace_id
      and participant.conversation_id = p_conversation_id
      and participant.left_at is null
    order by participant.first_seen_at, participant.id
    limit 1;

    if v_contact_id is null then return null; end if;

    select jsonb_build_object(
        'id', contact.id, 'display_name', contact.display_name,
        'classification', contact.classification,
        'operational_status', contact.operational_status,
        'registration_status', contact.registration_status,
        'notes', null, 'created_at', contact.created_at,
        'phone', (
            select point.display_value from public.contact_points as point
            where point.contact_id = contact.id and point.point_type = 'phone'
              and point.operational_status = 'active'
            order by point.created_at, point.id limit 1
        )
    ) into v_contact
    from public.contacts as contact where contact.id = v_contact_id;

    select coalesce(jsonb_agg(item order by created_at desc), '[]'::jsonb)
    into v_all_opportunities
    from (
        select opportunity.created_at, jsonb_build_object(
            'opportunity_id', opportunity.id, 'title', opportunity.title,
            'current_stage_id', opportunity.current_stage_id,
            'stage_name', stage.name, 'status', opportunity.status
        ) as item
        from public.opportunities as opportunity
        join public.pipeline_stages as stage on stage.id = opportunity.current_stage_id
        where opportunity.contact_id = v_contact_id
          and opportunity.archived_at is null
    ) as visible_opportunities;

    select jsonb_build_object(
        'opportunity_id', opportunity.id, 'title', opportunity.title,
        'description', opportunity.description,
        'current_stage_id', opportunity.current_stage_id,
        'stage_name', stage.name, 'status', opportunity.status,
        'responsible_member_id', opportunity.responsible_member_id,
        'responsible_name', responsible_user.display_name,
        'operation_type', opportunity.operation_type,
        'property_type_preference', opportunity.property_type_preference,
        'city_region_preference', opportunity.city_region_preference,
        'max_price_budget', opportunity.value_range_preference,
        'available_down_payment', opportunity.down_payment_available,
        'timeframe_intent', opportunity.timeframe_intent,
        'preferences_notes', coalesce(opportunity.property_summary, opportunity.preferences_notes),
        'rework_reason', opportunity.rework_reason
    ) into v_active_opportunity
    from public.opportunities as opportunity
    join public.pipeline_stages as stage on stage.id = opportunity.current_stage_id
    left join public.workspace_members as responsible on responsible.id = opportunity.responsible_member_id
    left join public.app_users as responsible_user on responsible_user.id = responsible.user_id
    where opportunity.contact_id = v_contact_id
      and opportunity.status in ('active', 'open')
      and opportunity.archived_at is null
    order by exists (
        select 1 from public.opportunity_conversations as link
        where link.opportunity_id = opportunity.id
          and link.conversation_id = p_conversation_id and link.unlinked_at is null
    ) desc, opportunity.created_at desc, opportunity.id desc
    limit 1;

    select coalesce(jsonb_agg(jsonb_build_object(
        'id', task.id, 'task_type', task.task_type, 'title', task.title,
        'description', task.description, 'status', task.status,
        'due_at', task.due_at, 'created_at', task.created_at
    ) order by (task.status = 'pending') desc, task.due_at, task.id), '[]'::jsonb)
    into v_tasks
    from public.work_tasks as task
    where task.archived_at is null
      and (task.conversation_id = p_conversation_id or task.contact_id = v_contact_id
           or task.opportunity_id = (v_active_opportunity->>'opportunity_id')::uuid);

    select coalesce(jsonb_agg(jsonb_build_object(
        'id', note.id, 'content', note.content, 'created_at', note.created_at,
        'author_name', author_user.display_name
    ) order by note.created_at desc, note.id desc), '[]'::jsonb)
    into v_notes
    from public.internal_notes as note
    join public.workspace_members as author on author.id = note.author_member_id
    join public.app_users as author_user on author_user.id = author.user_id
    where note.archived_at is null
      and (note.conversation_id = p_conversation_id or note.contact_id = v_contact_id
           or note.opportunity_id = (v_active_opportunity->>'opportunity_id')::uuid);

    select coalesce(jsonb_agg(event order by occurred_at desc), '[]'::jsonb)
    into v_timeline
    from (
        select history.changed_at as occurred_at, jsonb_build_object(
            'event_type', 'stage_change', 'occurred_at', history.changed_at,
            'title', 'Mudança de Etapa', 'description', stage.name,
            'actor', actor_user.display_name
        ) as event
        from public.pipeline_history as history
        join public.pipeline_stages as stage on stage.id = history.new_stage_id
        join public.workspace_members as actor on actor.id = history.changed_by_member_id
        join public.app_users as actor_user on actor_user.id = actor.user_id
        where history.opportunity_id = (v_active_opportunity->>'opportunity_id')::uuid
        union all
        select note.created_at, jsonb_build_object(
            'event_type', 'internal_note', 'occurred_at', note.created_at,
            'title', 'Nota Interna', 'description', note.content,
            'actor', author_user.display_name
        )
        from public.internal_notes as note
        join public.workspace_members as author on author.id = note.author_member_id
        join public.app_users as author_user on author_user.id = author.user_id
        where note.archived_at is null
          and (note.conversation_id = p_conversation_id
               or note.opportunity_id = (v_active_opportunity->>'opportunity_id')::uuid)
    ) as events;

    if v_context.member_role = 'owner' and v_active_opportunity is not null then
        select jsonb_build_object(
            'family_income', opportunity.family_income,
            'financial_analysis_status', opportunity.financial_analysis_status,
            'approved_credit_amount', opportunity.approved_amount,
            'financial_notes', opportunity.financial_notes,
            'docs_status', opportunity.documentation_status
        ) into v_financial
        from public.opportunities as opportunity
        where opportunity.id = (v_active_opportunity->>'opportunity_id')::uuid;
    end if;

    return jsonb_build_object(
        'contact', v_contact, 'active_opportunity', v_active_opportunity,
        'all_opportunities', v_all_opportunities, 'financial_info', v_financial,
        'tasks', v_tasks, 'notes', v_notes, 'timeline', v_timeline,
        'caller_role', v_context.member_role
    );
end;
$function$;

create or replace function public.get_prioridades_dashboard()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
    with visible_contacts as (
        select contact.*,
               conversation.id as conversation_id
        from public.contacts as contact
        left join lateral (
            select individual.id
            from public.contact_points as point
            join public.conversation_participants as participant
              on participant.contact_point_id = point.id and participant.left_at is null
            join public.conversations as individual
              on individual.id = participant.conversation_id
             and individual.conversation_type = 'individual'
            where point.contact_id = contact.id
            order by individual.started_at desc, individual.id desc
            limit 1
        ) as conversation on true
        where contact.operational_status = 'active' and contact.archived_at is null
    ),
    due_followups as (
        select task.*, coalesce(task.contact_id, opportunity.contact_id, point.contact_id) as resolved_contact_id,
               coalesce(task.conversation_id, conversation.id) as resolved_conversation_id
        from public.work_tasks as task
        left join public.opportunities as opportunity on opportunity.id = task.opportunity_id
        left join public.conversations as direct_conversation on direct_conversation.id = task.conversation_id
        left join public.conversation_participants as participant
          on participant.conversation_id = direct_conversation.id and participant.left_at is null
        left join public.contact_points as point on point.id = participant.contact_point_id
        left join lateral (
            select candidate.id from public.conversations as candidate
            join public.conversation_participants as candidate_participant
              on candidate_participant.conversation_id = candidate.id and candidate_participant.left_at is null
            join public.contact_points as candidate_point on candidate_point.id = candidate_participant.contact_point_id
            where candidate.conversation_type = 'individual'
              and candidate_point.contact_id = coalesce(task.contact_id, opportunity.contact_id, point.contact_id)
            order by candidate.started_at desc, candidate.id desc limit 1
        ) as conversation on true
        where task.task_type = 'follow_up' and task.status = 'pending'
          and task.archived_at is null and task.due_at <= statement_timestamp()
          and coalesce(direct_conversation.conversation_type, 'individual') = 'individual'
    )
    select jsonb_build_object(
        'pending_qualification', jsonb_build_object(
            'count', (select count(*) from visible_contacts where registration_status = 'provisional'),
            'items', coalesce((select jsonb_agg(jsonb_build_object(
                'id', id, 'display_name', display_name, 'classification', classification,
                'created_at', created_at, 'updated_at', updated_at, 'conversation_id', conversation_id
            ) order by created_at) from visible_contacts where registration_status = 'provisional'), '[]'::jsonb)
        ),
        'without_phone', jsonb_build_object(
            'count', (select count(*) from visible_contacts as contact where not exists (
                select 1 from public.contact_points as point where point.contact_id = contact.id
                  and point.point_type = 'phone' and point.operational_status = 'active')),
            'items', coalesce((select jsonb_agg(jsonb_build_object(
                'id', contact.id, 'display_name', contact.display_name,
                'classification', contact.classification, 'created_at', contact.created_at,
                'updated_at', contact.updated_at, 'conversation_id', contact.conversation_id
            ) order by contact.updated_at) from visible_contacts as contact where not exists (
                select 1 from public.contact_points as point where point.contact_id = contact.id
                  and point.point_type = 'phone' and point.operational_status = 'active')), '[]'::jsonb)
        ),
        'stale_leads', jsonb_build_object(
            'count', (select count(*) from visible_contacts where classification = 'lead'
                      and updated_at < statement_timestamp() - interval '15 days'),
            'items', coalesce((select jsonb_agg(jsonb_build_object(
                'id', id, 'display_name', display_name, 'classification', classification,
                'created_at', created_at, 'updated_at', updated_at, 'conversation_id', conversation_id
            ) order by updated_at) from visible_contacts where classification = 'lead'
              and updated_at < statement_timestamp() - interval '15 days'), '[]'::jsonb)
        ),
        'new_contacts', jsonb_build_object(
            'count', (select count(*) from visible_contacts where created_at >= statement_timestamp() - interval '7 days'),
            'items', coalesce((select jsonb_agg(jsonb_build_object(
                'id', id, 'display_name', display_name, 'classification', classification,
                'created_at', created_at, 'updated_at', updated_at, 'conversation_id', conversation_id
            ) order by created_at desc) from visible_contacts where created_at >= statement_timestamp() - interval '7 days'), '[]'::jsonb)
        ),
        'due_followups', coalesce((select jsonb_agg(jsonb_build_object(
            'id', followup.id, 'title', followup.title, 'due_at', followup.due_at,
            'contact_id', followup.resolved_contact_id,
            'conversation_id', followup.resolved_conversation_id,
            'display_name', contact.display_name
        ) order by followup.due_at, followup.id)
        from due_followups as followup
        join public.contacts as contact on contact.id = followup.resolved_contact_id), '[]'::jsonb)
    );
$function$;

revoke all on function public.get_prioridades_dashboard() from public, anon, service_role;
grant execute on function public.get_prioridades_dashboard() to authenticated;

create or replace function public.upsert_work_task(
    p_task_type text, p_title text, p_due_at timestamptz,
    p_contact_id uuid default null, p_opportunity_id uuid default null,
    p_conversation_id uuid default null, p_task_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_context record;
    v_task_id uuid;
begin
    select * into v_context from private.active_member_context() limit 1;
    if v_context.member_id is null then
        raise exception 'resource_not_available' using errcode = '42501';
    end if;
    if nullif(btrim(p_title), '') is null or p_task_type not in ('task', 'follow_up') then
        raise exception 'invalid_task' using errcode = '22023';
    end if;

    if p_task_id is not null then
        if not private.can_access_work_task(p_task_id) then
            raise exception 'resource_not_available' using errcode = '42501';
        end if;
        update public.work_tasks set title = btrim(p_title), due_at = coalesce(p_due_at, due_at),
            task_type = p_task_type, updated_at = statement_timestamp()
        where id = p_task_id and workspace_id = v_context.workspace_id
        returning id into v_task_id;
    else
        if num_nonnulls(p_contact_id, p_opportunity_id, p_conversation_id) < 1
           or (p_contact_id is not null and not private.can_access_contact(p_contact_id))
           or (p_opportunity_id is not null and not private.can_access_opportunity(p_opportunity_id))
           or (p_conversation_id is not null and not private.can_access_conversation(p_conversation_id)) then
            raise exception 'resource_not_available' using errcode = '42501';
        end if;
        if p_contact_id is not null and p_opportunity_id is not null and not exists (
            select 1 from public.opportunities where id = p_opportunity_id
              and contact_id = p_contact_id and workspace_id = v_context.workspace_id
        ) then raise exception 'resource_not_available' using errcode = '42501'; end if;
        if p_contact_id is not null and p_conversation_id is not null and not exists (
            select 1 from public.conversation_participants as participant
            join public.contact_points as point on point.id = participant.contact_point_id
            where participant.conversation_id = p_conversation_id
              and point.contact_id = p_contact_id and participant.left_at is null
        ) then
            raise exception 'resource_not_available' using errcode = '42501';
        end if;
        insert into public.work_tasks (
            workspace_id, task_type, title, status, priority, due_at,
            contact_id, opportunity_id, conversation_id, created_by_member_id
        ) values (
            v_context.workspace_id, p_task_type, btrim(p_title), 'pending', 'normal',
            coalesce(p_due_at, statement_timestamp() + interval '1 day'),
            p_contact_id, p_opportunity_id, p_conversation_id, v_context.member_id
        ) returning id into v_task_id;
    end if;
    return jsonb_build_object('success', true, 'task_id', v_task_id);
end;
$function$;

create or replace function public.complete_work_task(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare v_context record;
begin
    select * into v_context from private.active_member_context() limit 1;
    if v_context.member_id is null or not private.can_access_work_task(p_task_id) then
        raise exception 'resource_not_available' using errcode = '42501';
    end if;
    update public.work_tasks set status = 'completed', completed_at = statement_timestamp(),
        completed_by_member_id = v_context.member_id, updated_at = statement_timestamp()
    where id = p_task_id and workspace_id = v_context.workspace_id;
    return jsonb_build_object('success', true, 'task_id', p_task_id);
end;
$function$;

create or replace function public.update_contact_opportunity_qualification(
    p_contact_id uuid, p_opportunity_id uuid default null,
    p_operation_type text default null, p_property_type_preference text default null,
    p_city_region_preference text default null, p_max_price_budget numeric default null,
    p_available_down_payment numeric default null, p_timeframe_intent text default null,
    p_family_income numeric default null, p_financial_analysis_status text default null,
    p_approved_credit_amount numeric default null, p_docs_status text default null,
    p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare v_context record;
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
    return jsonb_build_object('success', true);
end;
$function$;
