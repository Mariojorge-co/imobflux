-- ImobFlux: tarefas completas (FLUXOS_NEGOCIO.md, fluxos 16 e 17).
--
-- Tarefa = ação operacional ligada a contato, oportunidade e/ou conversa, com tipo (tarefa ou follow-up),
-- prazo, prioridade, lembrete e responsável opcional. Regras:
--   * a tarefa herda as restrições do contexto (RLS can_access_work_task); quem não enxerga o contato/
--     conversa não enxerga a tarefa nem pode criá-la;
--   * o responsável precisa ser membro ATIVO; contexto privado (contato protegido, grupo não liberado)
--     só aceita OWNER como responsável (como na atribuição de conversa);
--   * concluir/cancelar só vale para tarefa pendente, registra ator e momento e nunca move a oportunidade
--     de etapa nem altera o contato;
--   * toda criação, edição, troca de responsável, conclusão e cancelamento é auditado (ids e nomes de
--     campos, nunca título ou descrição).
-- upsert_work_task e complete_work_task mantêm a assinatura (usados pela tela de conversa) e passam a auditar.

create or replace function private.is_task_context_team_visible(
    p_contact_id uuid,
    p_opportunity_id uuid,
    p_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
    select
        (
            p_contact_id is null
            or exists (
                select 1 from public.contacts as contact
                where contact.id = p_contact_id
                  and not contact.is_protected
                  and contact.commercial_visible_from is not null
            )
        )
        and (
            p_opportunity_id is null
            or exists (
                select 1
                from public.opportunities as opportunity
                join public.contacts as contact
                  on contact.workspace_id = opportunity.workspace_id
                 and contact.id = opportunity.contact_id
                where opportunity.id = p_opportunity_id
                  and not contact.is_protected
                  and contact.commercial_visible_from is not null
            )
        )
        and (p_conversation_id is null or private.is_conversation_team_visible(p_conversation_id));
$function$;

revoke all on function private.is_task_context_team_visible(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.create_work_task(
    p_title text,
    p_task_type text default 'task',
    p_due_at timestamptz default null,
    p_priority text default 'normal',
    p_responsible_member_id uuid default null,
    p_description text default null,
    p_reminder_at timestamptz default null,
    p_contact_id uuid default null,
    p_opportunity_id uuid default null,
    p_conversation_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_context record;
    v_task_id uuid;
    v_title text := pg_catalog.btrim(coalesce(p_title, ''));
    v_description text := nullif(pg_catalog.btrim(coalesce(p_description, '')), '');
    v_due timestamptz;
    v_target_role text;
    v_now timestamptz := pg_catalog.statement_timestamp();
begin
    select * into v_context from private.active_member_context() limit 1;
    if v_context.member_id is null then
        raise exception 'resource_not_available' using errcode = '42501';
    end if;

    if v_title = '' or pg_catalog.length(v_title) > 200
       or coalesce(p_task_type, '') not in ('task', 'follow_up')
       or coalesce(p_priority, '') not in ('low', 'normal', 'high', 'urgent')
       or (v_description is not null and pg_catalog.length(v_description) > 2000) then
        raise exception 'invalid_task' using errcode = '22023';
    end if;

    if num_nonnulls(p_contact_id, p_opportunity_id, p_conversation_id) < 1
       or (p_contact_id is not null and not private.can_access_contact(p_contact_id))
       or (p_opportunity_id is not null and not private.can_access_opportunity(p_opportunity_id))
       or (p_conversation_id is not null and not private.can_access_conversation(p_conversation_id)) then
        raise exception 'resource_not_available' using errcode = '42501';
    end if;
    if p_contact_id is not null and p_opportunity_id is not null and not exists (
        select 1 from public.opportunities
        where id = p_opportunity_id and contact_id = p_contact_id and workspace_id = v_context.workspace_id
    ) then
        raise exception 'resource_not_available' using errcode = '42501';
    end if;
    if p_contact_id is not null and p_conversation_id is not null and not exists (
        select 1 from public.conversation_participants as participant
        join public.contact_points as point on point.id = participant.contact_point_id
        where participant.conversation_id = p_conversation_id
          and point.contact_id = p_contact_id and participant.left_at is null
    ) then
        raise exception 'resource_not_available' using errcode = '42501';
    end if;

    v_due := coalesce(p_due_at, v_now + interval '1 day');
    if p_reminder_at is not null and p_reminder_at > v_due then
        raise exception 'invalid_task' using errcode = '22023';
    end if;

    if p_responsible_member_id is not null then
        select member.role into v_target_role
        from public.workspace_members as member
        where member.id = p_responsible_member_id
          and member.workspace_id = v_context.workspace_id
          and member.status = 'active';
        if v_target_role is null then
            raise exception 'assignee_not_active' using errcode = '22023';
        end if;
        if v_target_role = 'attendant'
           and not private.is_task_context_team_visible(p_contact_id, p_opportunity_id, p_conversation_id) then
            raise exception 'assignee_cannot_access_task' using errcode = '22023';
        end if;
    end if;

    insert into public.work_tasks (
        workspace_id, task_type, title, description, status, priority, due_at, reminder_at,
        responsible_member_id, contact_id, opportunity_id, conversation_id, created_by_member_id
    ) values (
        v_context.workspace_id, p_task_type, v_title, v_description, 'pending', p_priority, v_due, p_reminder_at,
        p_responsible_member_id, p_contact_id, p_opportunity_id, p_conversation_id, v_context.member_id
    ) returning id into v_task_id;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type,
        target_id, result, metadata, occurred_at, recorded_at
    ) values (
        v_context.workspace_id, 'member', v_context.member_id, 'task.created', 'task', v_task_id, 'success',
        pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
            'task_type', p_task_type, 'priority', p_priority,
            'responsible_member_id', p_responsible_member_id,
            'contact_id', p_contact_id, 'opportunity_id', p_opportunity_id, 'conversation_id', p_conversation_id
        )),
        v_now, v_now
    );

    return pg_catalog.jsonb_build_object('success', true, 'task_id', v_task_id);
end;
$function$;

create or replace function public.update_work_task(
    p_task_id uuid,
    p_title text default null,
    p_due_at timestamptz default null,
    p_task_type text default null,
    p_priority text default null,
    p_description text default null,
    p_reminder_at timestamptz default null,
    p_clear_reminder boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_context record;
    v_task public.work_tasks%rowtype;
    v_title text;
    v_description text;
    v_due timestamptz;
    v_reminder timestamptz;
    v_fields text[];
    v_now timestamptz := pg_catalog.statement_timestamp();
begin
    select * into v_context from private.active_member_context() limit 1;
    if v_context.member_id is null or not private.can_access_work_task(p_task_id) then
        raise exception 'resource_not_available' using errcode = '42501';
    end if;

    select task.* into v_task
    from public.work_tasks as task
    where task.id = p_task_id and task.workspace_id = v_context.workspace_id
    for update;
    if not found then
        raise exception 'resource_not_available' using errcode = '42501';
    end if;
    if v_task.status <> 'pending' then
        raise exception 'task_not_pending' using errcode = '55000';
    end if;

    if (p_title is not null and pg_catalog.btrim(p_title) = '')
       or (p_title is not null and pg_catalog.length(pg_catalog.btrim(p_title)) > 200)
       or (p_task_type is not null and p_task_type not in ('task', 'follow_up'))
       or (p_priority is not null and p_priority not in ('low', 'normal', 'high', 'urgent'))
       or (p_description is not null and pg_catalog.length(pg_catalog.btrim(p_description)) > 2000) then
        raise exception 'invalid_task' using errcode = '22023';
    end if;

    v_title := coalesce(pg_catalog.btrim(p_title), v_task.title);
    v_description := case when p_description is null then v_task.description else nullif(pg_catalog.btrim(p_description), '') end;
    v_due := coalesce(p_due_at, v_task.due_at);
    v_reminder := case when p_clear_reminder then null else coalesce(p_reminder_at, v_task.reminder_at) end;
    if v_reminder is not null and v_reminder > v_due then
        raise exception 'invalid_task' using errcode = '22023';
    end if;

    update public.work_tasks
    set title = v_title,
        description = v_description,
        due_at = v_due,
        reminder_at = v_reminder,
        task_type = coalesce(p_task_type, v_task.task_type),
        priority = coalesce(p_priority, v_task.priority),
        updated_at = greatest(v_now, v_task.created_at)
    where id = v_task.id;

    v_fields := array_remove(array[
        case when p_title is not null then 'title' end,
        case when p_description is not null then 'description' end,
        case when p_due_at is not null then 'due_at' end,
        case when p_reminder_at is not null or p_clear_reminder then 'reminder_at' end,
        case when p_task_type is not null then 'task_type' end,
        case when p_priority is not null then 'priority' end
    ], null);

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type,
        target_id, result, metadata, occurred_at, recorded_at
    ) values (
        v_context.workspace_id, 'member', v_context.member_id, 'task.updated', 'task', v_task.id, 'success',
        pg_catalog.jsonb_build_object('fields', pg_catalog.to_jsonb(coalesce(v_fields, array[]::text[]))),
        v_now, v_now
    );

    return pg_catalog.jsonb_build_object('success', true, 'task_id', v_task.id);
end;
$function$;

-- Troca de responsável da tarefa (null = deixa sem responsável).
create or replace function public.reassign_work_task(p_task_id uuid, p_responsible_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_context record;
    v_task public.work_tasks%rowtype;
    v_target_role text;
    v_now timestamptz := pg_catalog.statement_timestamp();
begin
    select * into v_context from private.active_member_context() limit 1;
    if v_context.member_id is null or not private.can_access_work_task(p_task_id) then
        raise exception 'resource_not_available' using errcode = '42501';
    end if;

    select task.* into v_task
    from public.work_tasks as task
    where task.id = p_task_id and task.workspace_id = v_context.workspace_id
    for update;
    if not found then
        raise exception 'resource_not_available' using errcode = '42501';
    end if;
    if v_task.status <> 'pending' then
        raise exception 'task_not_pending' using errcode = '55000';
    end if;

    if v_task.responsible_member_id is not distinct from p_responsible_member_id then
        return pg_catalog.jsonb_build_object('success', true, 'status', 'unchanged');
    end if;

    if p_responsible_member_id is not null then
        select member.role into v_target_role
        from public.workspace_members as member
        where member.id = p_responsible_member_id
          and member.workspace_id = v_context.workspace_id
          and member.status = 'active';
        if v_target_role is null then
            raise exception 'assignee_not_active' using errcode = '22023';
        end if;
        if v_target_role = 'attendant'
           and not private.is_task_context_team_visible(v_task.contact_id, v_task.opportunity_id, v_task.conversation_id) then
            raise exception 'assignee_cannot_access_task' using errcode = '22023';
        end if;
    end if;

    update public.work_tasks
    set responsible_member_id = p_responsible_member_id,
        updated_at = greatest(v_now, v_task.created_at)
    where id = v_task.id;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type,
        target_id, result, metadata, occurred_at, recorded_at
    ) values (
        v_context.workspace_id, 'member', v_context.member_id, 'task.reassigned', 'task', v_task.id, 'success',
        pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
            'from_member_id', v_task.responsible_member_id, 'to_member_id', p_responsible_member_id
        )),
        v_now, v_now
    );

    return pg_catalog.jsonb_build_object(
        'success', true,
        'status', case when p_responsible_member_id is null then 'unassigned' else 'reassigned' end
    );
end;
$function$;

-- Concluir (mantém a assinatura): só pendente, registra ator/momento e audita. Não mexe em etapa nem contato.
create or replace function public.complete_work_task(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_context record;
    v_task public.work_tasks%rowtype;
    v_now timestamptz := pg_catalog.statement_timestamp();
begin
    select * into v_context from private.active_member_context() limit 1;
    if v_context.member_id is null or not private.can_access_work_task(p_task_id) then
        raise exception 'resource_not_available' using errcode = '42501';
    end if;

    select task.* into v_task
    from public.work_tasks as task
    where task.id = p_task_id and task.workspace_id = v_context.workspace_id
    for update;
    if not found then
        raise exception 'resource_not_available' using errcode = '42501';
    end if;
    if v_task.status <> 'pending' then
        raise exception 'task_not_pending' using errcode = '55000';
    end if;

    update public.work_tasks
    set status = 'completed',
        completed_at = greatest(v_now, v_task.created_at),
        completed_by_member_id = v_context.member_id,
        updated_at = greatest(v_now, v_task.created_at)
    where id = v_task.id;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type,
        target_id, result, metadata, occurred_at, recorded_at
    ) values (
        v_context.workspace_id, 'member', v_context.member_id, 'task.completed', 'task', v_task.id, 'success',
        '{}'::jsonb, v_now, v_now
    );

    return pg_catalog.jsonb_build_object('success', true, 'task_id', v_task.id);
end;
$function$;

create or replace function public.cancel_work_task(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_context record;
    v_task public.work_tasks%rowtype;
    v_now timestamptz := pg_catalog.statement_timestamp();
begin
    select * into v_context from private.active_member_context() limit 1;
    if v_context.member_id is null or not private.can_access_work_task(p_task_id) then
        raise exception 'resource_not_available' using errcode = '42501';
    end if;

    select task.* into v_task
    from public.work_tasks as task
    where task.id = p_task_id and task.workspace_id = v_context.workspace_id
    for update;
    if not found then
        raise exception 'resource_not_available' using errcode = '42501';
    end if;
    if v_task.status <> 'pending' then
        raise exception 'task_not_pending' using errcode = '55000';
    end if;

    update public.work_tasks
    set status = 'cancelled',
        cancelled_at = greatest(v_now, v_task.created_at),
        cancelled_by_member_id = v_context.member_id,
        updated_at = greatest(v_now, v_task.created_at)
    where id = v_task.id;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type,
        target_id, result, metadata, occurred_at, recorded_at
    ) values (
        v_context.workspace_id, 'member', v_context.member_id, 'task.cancelled', 'task', v_task.id, 'success',
        '{}'::jsonb, v_now, v_now
    );

    return pg_catalog.jsonb_build_object('success', true, 'task_id', v_task.id);
end;
$function$;

-- Assinatura e comportamento preservados (tela de conversa); acrescenta a auditoria.
create or replace function public.upsert_work_task(
    p_task_type text,
    p_title text,
    p_due_at timestamptz,
    p_contact_id uuid default null,
    p_opportunity_id uuid default null,
    p_conversation_id uuid default null,
    p_task_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_context record;
    v_task_id uuid;
    v_now timestamptz := pg_catalog.statement_timestamp();
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

        if v_task_id is not null then
            insert into public.audit_events (
                workspace_id, actor_type, actor_member_id, action, target_type,
                target_id, result, metadata, occurred_at, recorded_at
            ) values (
                v_context.workspace_id, 'member', v_context.member_id, 'task.updated', 'task', v_task_id, 'success',
                pg_catalog.jsonb_build_object('fields', pg_catalog.jsonb_build_array('title', 'due_at', 'task_type')),
                v_now, v_now
            );
        end if;
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

        insert into public.audit_events (
            workspace_id, actor_type, actor_member_id, action, target_type,
            target_id, result, metadata, occurred_at, recorded_at
        ) values (
            v_context.workspace_id, 'member', v_context.member_id, 'task.created', 'task', v_task_id, 'success',
            pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
                'task_type', p_task_type, 'priority', 'normal',
                'contact_id', p_contact_id, 'opportunity_id', p_opportunity_id, 'conversation_id', p_conversation_id
            )),
            v_now, v_now
        );
    end if;
    return jsonb_build_object('success', true, 'task_id', v_task_id);
end;
$function$;

-- Listagem (SECURITY INVOKER: a RLS de work_tasks já aplica a visibilidade herdada do contexto).
-- p_status: pending | completed | cancelled | all; p_scope: all | mine | unassigned.
create or replace function public.get_work_tasks(
    p_status text default 'pending',
    p_scope text default 'all',
    p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
    v_limit integer := greatest(1, least(coalesce(p_limit, 100), 200));
    v_now timestamptz := pg_catalog.statement_timestamp();
    v_result jsonb;
begin
    if coalesce(p_status, '') not in ('pending', 'completed', 'cancelled', 'all')
       or coalesce(p_scope, '') not in ('all', 'mine', 'unassigned') then
        raise exception 'invalid_task_filter' using errcode = '22023';
    end if;

    with me as (
        select context.member_id, context.workspace_id
        from private.active_member_context() as context
        limit 1
    ), visible as (
        select task.*
        from public.work_tasks as task
        join me on me.workspace_id = task.workspace_id
        where task.archived_at is null
    ), filtered as (
        select visible.*
        from visible, me
        where (p_status = 'all' or visible.status = p_status)
          and (
              p_scope = 'all'
              or (p_scope = 'mine' and visible.responsible_member_id = me.member_id)
              or (p_scope = 'unassigned' and visible.responsible_member_id is null)
          )
        order by
            case when visible.status = 'pending' then 0 else 1 end,
            case when visible.status = 'pending' then visible.due_at end asc,
            coalesce(visible.completed_at, visible.cancelled_at) desc nulls last,
            visible.id
        limit v_limit
    ), counts as (
        select
            count(*) filter (where visible.status = 'pending') as pending,
            count(*) filter (where visible.status = 'pending' and visible.due_at < v_now) as overdue,
            count(*) filter (where visible.status = 'pending' and visible.responsible_member_id = me.member_id) as mine,
            count(*) filter (where visible.status = 'completed') as completed
        from visible, me
    )
    select jsonb_build_object(
        'tasks', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'id', filtered.id,
                    'task_type', filtered.task_type,
                    'title', filtered.title,
                    'description', filtered.description,
                    'status', filtered.status,
                    'priority', filtered.priority,
                    'due_at', filtered.due_at,
                    'reminder_at', filtered.reminder_at,
                    'is_overdue', filtered.status = 'pending' and filtered.due_at < v_now,
                    'responsible_member_id', filtered.responsible_member_id,
                    'responsible_name', private.member_display_name(filtered.workspace_id, filtered.responsible_member_id),
                    'created_by_name', private.member_display_name(filtered.workspace_id, filtered.created_by_member_id),
                    'contact_id', filtered.contact_id,
                    'contact_name', contact.display_name,
                    'opportunity_id', filtered.opportunity_id,
                    'opportunity_title', opportunity.title,
                    'conversation_id', filtered.conversation_id,
                    'completed_at', filtered.completed_at,
                    'cancelled_at', filtered.cancelled_at,
                    'created_at', filtered.created_at
                ) order by
                    case when filtered.status = 'pending' then 0 else 1 end,
                    case when filtered.status = 'pending' then filtered.due_at end asc,
                    coalesce(filtered.completed_at, filtered.cancelled_at) desc nulls last,
                    filtered.id
            )
            from filtered
            left join public.contacts as contact
              on contact.workspace_id = filtered.workspace_id and contact.id = filtered.contact_id
            left join public.opportunities as opportunity
              on opportunity.workspace_id = filtered.workspace_id and opportunity.id = filtered.opportunity_id
        ), '[]'::jsonb),
        'counts', (
            select jsonb_build_object('pending', counts.pending, 'overdue', counts.overdue, 'mine', counts.mine, 'completed', counts.completed)
            from counts
        )
    ) into v_result;

    return v_result;
end;
$function$;

alter function public.create_work_task(text, text, timestamptz, text, uuid, text, timestamptz, uuid, uuid, uuid) owner to postgres;
alter function public.update_work_task(uuid, text, timestamptz, text, text, text, timestamptz, boolean) owner to postgres;
alter function public.reassign_work_task(uuid, uuid) owner to postgres;
alter function public.cancel_work_task(uuid) owner to postgres;
alter function public.get_work_tasks(text, text, integer) owner to postgres;
revoke all on function public.create_work_task(text, text, timestamptz, text, uuid, text, timestamptz, uuid, uuid, uuid) from public, anon, service_role;
revoke all on function public.update_work_task(uuid, text, timestamptz, text, text, text, timestamptz, boolean) from public, anon, service_role;
revoke all on function public.reassign_work_task(uuid, uuid) from public, anon, service_role;
revoke all on function public.cancel_work_task(uuid) from public, anon, service_role;
revoke all on function public.get_work_tasks(text, text, integer) from public, anon, service_role;
grant execute on function public.create_work_task(text, text, timestamptz, text, uuid, text, timestamptz, uuid, uuid, uuid) to authenticated;
grant execute on function public.update_work_task(uuid, text, timestamptz, text, text, text, timestamptz, boolean) to authenticated;
grant execute on function public.reassign_work_task(uuid, uuid) to authenticated;
grant execute on function public.cancel_work_task(uuid) to authenticated;
grant execute on function public.get_work_tasks(text, text, integer) to authenticated;
