-- Migration Sprint 23: Evolução Operacional e Conversas 2.0
-- RPCs e Estruturas para Painel de Contexto, SLA Operacional, Notas Internas, Next Actions e Controle de Leitura.

set search_path to public, extensions, pg_catalog;

-- 1. Tabela para estado de leitura por conversa e membro
create table if not exists public.conversation_read_states (
    id uuid default gen_random_uuid() not null,
    workspace_id uuid not null,
    conversation_id uuid not null,
    member_id uuid not null,
    is_unread boolean default false not null,
    marked_unread_at timestamptz,
    last_read_at timestamptz default now() not null,
    created_at timestamptz default now() not null,
    updated_at timestamptz default now() not null,

    constraint pk_conversation_read_states primary key (id),
    constraint uq_conversation_read_states_member unique (workspace_id, conversation_id, member_id),
    constraint fk_conversation_read_states_workspace foreign key (workspace_id) references public.workspaces(id) on delete restrict,
    constraint fk_conversation_read_states_conversation foreign key (workspace_id, conversation_id) references public.conversations(workspace_id, id) on delete restrict,
    constraint fk_conversation_read_states_member foreign key (workspace_id, member_id) references public.workspace_members(workspace_id, id) on delete restrict
);

alter table public.conversation_read_states enable row level security;

grant select, insert, update, delete on public.conversation_read_states to authenticated;
grant select, insert, update, delete on public.conversation_read_states to service_role;

drop policy if exists owner_member_read_states_select on public.conversation_read_states;
drop policy if exists owner_member_read_states_all on public.conversation_read_states;

create policy owner_member_read_states_all on public.conversation_read_states
    for all to authenticated
    using (
        workspace_id in (
            select wm.workspace_id
            from public.workspace_members wm
            join public.app_users u on u.id = wm.user_id
            where u.auth_user_id = auth.uid()
              and wm.status = 'active'
        )
    );

-- 2. RPC para alternar marcação de "não lida"
create or replace function public.mark_conversation_unread(
    p_conversation_id uuid,
    p_unread boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_member_id uuid;
begin
  select workspace_id into v_workspace_id
  from public.conversations
  where id = p_conversation_id;

  if v_workspace_id is null then
    raise exception 'Conversa não encontrada.';
  end if;

  select wm.id into v_member_id
  from public.workspace_members wm
  join public.app_users u on u.id = wm.user_id
  where wm.workspace_id = v_workspace_id
    and u.auth_user_id = auth.uid()
    and wm.status = 'active'
  limit 1;

  if v_member_id is null then
    raise exception 'Membro não encontrado no workspace.';
  end if;

  insert into public.conversation_read_states (
    workspace_id,
    conversation_id,
    member_id,
    is_unread,
    marked_unread_at,
    last_read_at,
    updated_at
  )
  values (
    v_workspace_id,
    p_conversation_id,
    v_member_id,
    p_unread,
    case when p_unread then now() else null end,
    now(),
    now()
  )
  on conflict (workspace_id, conversation_id, member_id)
  do update set
    is_unread = excluded.is_unread,
    marked_unread_at = case when excluded.is_unread then now() else conversation_read_states.marked_unread_at end,
    last_read_at = case when not excluded.is_unread then now() else conversation_read_states.last_read_at end,
    updated_at = now();

  return jsonb_build_object('success', true, 'is_unread', p_unread);
end;
$$;

revoke all on function public.mark_conversation_unread(uuid, boolean) from public, anon, service_role;
grant execute on function public.mark_conversation_unread(uuid, boolean) to authenticated;

-- 3. RPC para salvar nota interna
create or replace function public.save_internal_note(
    p_conversation_id uuid,
    p_content text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_member_id uuid;
  v_note_id uuid;
  v_trimmed text;
begin
  v_trimmed := btrim(p_content);
  if v_trimmed is null or v_trimmed = '' then
    raise exception 'Conteúdo da nota interna não pode ser vazio.';
  end if;

  select workspace_id into v_workspace_id
  from public.conversations
  where id = p_conversation_id;

  if v_workspace_id is null then
    raise exception 'Conversa não encontrada.';
  end if;

  select wm.id into v_member_id
  from public.workspace_members wm
  join public.app_users u on u.id = wm.user_id
  where wm.workspace_id = v_workspace_id
    and u.auth_user_id = auth.uid()
    and wm.status = 'active'
  limit 1;

  if v_member_id is null then
    raise exception 'Membro não encontrado no workspace.';
  end if;

  insert into public.internal_notes (
    workspace_id,
    author_member_id,
    content,
    conversation_id,
    created_at,
    updated_at
  )
  values (
    v_workspace_id,
    v_member_id,
    v_trimmed,
    p_conversation_id,
    now(),
    now()
  )
  returning id into v_note_id;

  return jsonb_build_object('success', true, 'note_id', v_note_id);
end;
$$;

revoke all on function public.save_internal_note(uuid, text) from public, anon, service_role;
grant execute on function public.save_internal_note(uuid, text) to authenticated;

-- 4. RPC para buscar contexto completo da conversa & cliente
create or replace function public.get_conversation_context(
    p_conversation_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_caller_role text;
  v_caller_member_id uuid;
  v_contact_id uuid;
  v_contact_info jsonb;
  v_active_opportunity jsonb;
  v_all_opportunities jsonb;
  v_financial_info jsonb;
  v_tasks jsonb;
  v_timeline jsonb;
  v_notes jsonb;
begin
  select workspace_id into v_workspace_id
  from public.conversations
  where id = p_conversation_id;

  if v_workspace_id is null then
    return null;
  end if;

  select wm.id, wm.role into v_caller_member_id, v_caller_role
  from public.workspace_members wm
  join public.app_users u on u.id = wm.user_id
  where wm.workspace_id = v_workspace_id
    and u.auth_user_id = auth.uid()
    and wm.status = 'active'
  limit 1;

  -- Localiza o contato principal da conversa
  select ct.id into v_contact_id
  from public.conversation_participants cp
  join public.contact_points cp_point on cp_point.workspace_id = cp.workspace_id and cp_point.id = cp.contact_point_id
  join public.contacts ct on ct.workspace_id = cp_point.workspace_id and ct.id = cp_point.contact_id
  where cp.workspace_id = v_workspace_id
    and cp.conversation_id = p_conversation_id
    and cp.left_at is null
  order by cp.first_seen_at asc
  limit 1;

  if v_contact_id is null then
    select ct.id into v_contact_id
    from public.contacts ct
    where ct.workspace_id = v_workspace_id
    order by ct.created_at asc
    limit 1;
  end if;

  -- 1. Informações do contato
  select jsonb_build_object(
    'id', ct.id,
    'display_name', ct.display_name,
    'classification', ct.classification,
    'operational_status', ct.operational_status,
    'registration_status', ct.registration_status,
    'notes', null::text,
    'created_at', ct.created_at,
    'phone', (
      select cp_point.display_value
      from public.contact_points cp_point
      where cp_point.workspace_id = ct.workspace_id
        and cp_point.contact_id = ct.id
        and cp_point.point_type = 'phone'
      limit 1
    )
  ) into v_contact_info
  from public.contacts ct
  where ct.workspace_id = v_workspace_id and ct.id = v_contact_id;

  -- 2. Oportunidade Ativa vinculada a esta conversa ou contato
  select jsonb_build_object(
    'opportunity_id', o.id,
    'title', o.title,
    'description', o.description,
    'current_stage_id', o.current_stage_id,
    'stage_name', ps.name,
    'status', o.status,
    'responsible_member_id', o.responsible_member_id,
    'responsible_name', u_resp.display_name,
    'operation_type', o.operation_type,
    'property_type_preference', o.property_type_preference,
    'city_region_preference', o.city_region_preference,
    'max_price_budget', o.value_range_preference,
    'available_down_payment', o.down_payment_available,
    'timeframe_intent', o.timeframe_intent,
    'preferences_notes', o.property_summary,
    'rework_reason', o.rework_reason
  ) into v_active_opportunity
  from public.opportunity_conversations oc
  join public.opportunities o on o.workspace_id = oc.workspace_id and o.id = oc.opportunity_id
  join public.pipeline_stages ps on ps.workspace_id = o.workspace_id and ps.id = o.current_stage_id
  left join public.workspace_members wm_resp on wm_resp.workspace_id = o.workspace_id and wm_resp.id = o.responsible_member_id
  left join public.app_users u_resp on u_resp.id = wm_resp.user_id
  where oc.workspace_id = v_workspace_id
    and oc.conversation_id = p_conversation_id
    and oc.unlinked_at is null
  order by oc.linked_at desc
  limit 1;

  if v_active_opportunity is null and v_contact_id is not null then
    select jsonb_build_object(
      'opportunity_id', o.id,
      'title', o.title,
      'description', o.description,
      'current_stage_id', o.current_stage_id,
      'stage_name', ps.name,
      'status', o.status,
      'responsible_member_id', o.responsible_member_id,
      'responsible_name', u_resp.display_name,
      'operation_type', o.operation_type,
      'property_type_preference', o.property_type_preference,
      'city_region_preference', o.city_region_preference,
      'max_price_budget', o.max_price_budget,
      'available_down_payment', o.available_down_payment,
      'timeframe_intent', o.timeframe_intent,
      'preferences_notes', o.preferences_notes,
      'rework_reason', o.rework_reason
    ) into v_active_opportunity
    from public.opportunities o
    join public.pipeline_stages ps on ps.workspace_id = o.workspace_id and ps.id = o.current_stage_id
    left join public.workspace_members wm_resp on wm_resp.workspace_id = o.workspace_id and wm_resp.id = o.responsible_member_id
    left join public.app_users u_resp on u_resp.id = wm_resp.user_id
    where o.workspace_id = v_workspace_id
      and o.contact_id = v_contact_id
      and o.status = 'active'
    order by o.created_at desc
    limit 1;
  end if;

  -- 3. Lista de todas as oportunidades do contato
  select coalesce(jsonb_agg(item), '[]'::jsonb) into v_all_opportunities
  from (
    select jsonb_build_object(
      'opportunity_id', o.id,
      'title', o.title,
      'current_stage_id', o.current_stage_id,
      'stage_name', ps.name,
      'status', o.status
    ) as item
    from public.opportunities o
    join public.pipeline_stages ps on ps.workspace_id = o.workspace_id and ps.id = o.current_stage_id
    where o.workspace_id = v_workspace_id
      and o.contact_id = v_contact_id
    order by (o.status = 'active') desc, o.created_at desc
  ) sub;

  -- 4. Informações Financeiras & Análise (APENAS SE ROLE = 'owner', senão NULL)
  if v_caller_role = 'owner' then
    select jsonb_build_object(
      'family_income', o.family_income,
      'financial_analysis_status', o.financial_analysis_status,
      'approved_credit_amount', o.approved_amount,
      'financial_notes', o.financial_notes,
      'docs_status', o.documentation_status
    ) into v_financial_info
    from public.opportunities o
    where o.workspace_id = v_workspace_id
      and o.id = (v_active_opportunity->>'opportunity_id')::uuid;
  else
    v_financial_info := null;
  end if;

  -- 5. Tarefas (Próxima Ação & Follow-up)
  select coalesce(jsonb_agg(item), '[]'::jsonb) into v_tasks
  from (
    select jsonb_build_object(
      'id', wt.id,
      'task_type', wt.task_type,
      'title', wt.title,
      'description', wt.description,
      'status', wt.status,
      'due_at', wt.due_at,
      'created_at', wt.created_at
    ) as item
    from public.work_tasks wt
    where wt.workspace_id = v_workspace_id
      and (
        wt.conversation_id = p_conversation_id
        or wt.contact_id = v_contact_id
        or wt.opportunity_id = (v_active_opportunity->>'opportunity_id')::uuid
      )
      and wt.archived_at is null
    order by (wt.status = 'pending') desc, wt.due_at asc
  ) sub;

  -- 6. Notas internas
  select coalesce(jsonb_agg(item), '[]'::jsonb) into v_notes
  from (
    select jsonb_build_object(
      'id', n.id,
      'content', n.content,
      'created_at', n.created_at,
      'author_name', u.display_name
    ) as item
    from public.internal_notes n
    join public.workspace_members wm on wm.workspace_id = n.workspace_id and wm.id = n.author_member_id
    join public.app_users u on u.id = wm.user_id
    where n.workspace_id = v_workspace_id
      and (
        n.conversation_id = p_conversation_id
        or n.contact_id = v_contact_id
        or n.opportunity_id = (v_active_opportunity->>'opportunity_id')::uuid
      )
      and n.archived_at is null
    order by n.created_at desc
    limit 20
  ) sub;

  -- 7. Timeline consolidada
  select coalesce(jsonb_agg(item), '[]'::jsonb) into v_timeline
  from (
    select item from (
      select jsonb_build_object(
        'event_type', 'stage_change',
        'occurred_at', ph.changed_at,
        'title', 'Mudança de Etapa',
        'description', coalesce(ps_new.name, 'Etapa atualizada') || coalesce(' (motivo: ' || ph.reason || ')', ''),
        'actor', u.display_name
      ) as item,
      ph.changed_at as occurred_at
      from public.pipeline_history ph
      join public.pipeline_stages ps_new on ps_new.workspace_id = ph.workspace_id and ps_new.id = ph.new_stage_id
      join public.workspace_members wm on wm.workspace_id = ph.workspace_id and wm.id = ph.changed_by_member_id
      join public.app_users u on u.id = wm.user_id
      where ph.workspace_id = v_workspace_id
        and ph.opportunity_id = (v_active_opportunity->>'opportunity_id')::uuid

      union all

      select jsonb_build_object(
        'event_type', 'internal_note',
        'occurred_at', n.created_at,
        'title', 'Nota Interna',
        'description', n.content,
        'actor', u.display_name
      ) as item,
      n.created_at as occurred_at
      from public.internal_notes n
      join public.workspace_members wm on wm.workspace_id = n.workspace_id and wm.id = n.author_member_id
      join public.app_users u on u.id = wm.user_id
      where n.workspace_id = v_workspace_id
        and (n.conversation_id = p_conversation_id or n.contact_id = v_contact_id)
        and n.archived_at is null

      union all

      select jsonb_build_object(
        'event_type', 'task',
        'occurred_at', wt.created_at,
        'title', case when wt.task_type = 'follow_up' then 'Follow-up Registrado' else 'Próxima Ação Criada' end,
        'description', wt.title,
        'actor', u.display_name
      ) as item,
      wt.created_at as occurred_at
      from public.work_tasks wt
      join public.workspace_members wm on wm.workspace_id = wt.workspace_id and wm.id = wt.created_by_member_id
      join public.app_users u on u.id = wm.user_id
      where wt.workspace_id = v_workspace_id
        and (wt.conversation_id = p_conversation_id or wt.contact_id = v_contact_id)
        and wt.archived_at is null
    ) inner_sub
    order by occurred_at desc
    limit 30
  ) sub;

  return jsonb_build_object(
    'contact', v_contact_info,
    'active_opportunity', v_active_opportunity,
    'all_opportunities', v_all_opportunities,
    'financial_info', v_financial_info,
    'tasks', v_tasks,
    'notes', v_notes,
    'timeline', v_timeline,
    'caller_role', v_caller_role
  );
end;
$$;

revoke all on function public.get_conversation_context(uuid) from public, anon, service_role;
grant execute on function public.get_conversation_context(uuid) to authenticated;

-- 5. RPC para gerenciar tarefas (Próxima Ação & Follow-up)
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
as $$
declare
  v_workspace_id uuid;
  v_member_id uuid;
  v_result_id uuid;
  v_trimmed_title text;
begin
  v_trimmed_title := btrim(p_title);
  if v_trimmed_title is null or v_trimmed_title = '' then
    raise exception 'Título da tarefa é obrigatório.';
  end if;

  select wm.workspace_id, wm.id into v_workspace_id, v_member_id
  from public.workspace_members wm
  join public.app_users u on u.id = wm.user_id
  where u.auth_user_id = auth.uid()
    and wm.status = 'active'
  limit 1;

  if v_workspace_id is null then
    raise exception 'Sessão inválida ou sem workspace ativo.';
  end if;

  if p_task_id is not null then
    update public.work_tasks
    set title = v_trimmed_title,
        due_at = coalesce(p_due_at, due_at),
        updated_at = now()
    where workspace_id = v_workspace_id
      and id = p_task_id
    returning id into v_result_id;
  else
    insert into public.work_tasks (
      workspace_id,
      task_type,
      title,
      status,
      priority,
      due_at,
      contact_id,
      opportunity_id,
      conversation_id,
      created_by_member_id,
      created_at,
      updated_at
    )
    values (
      v_workspace_id,
      coalesce(p_task_type, 'task'),
      v_trimmed_title,
      'pending',
      'normal',
      coalesce(p_due_at, now() + interval '1 day'),
      p_contact_id,
      p_opportunity_id,
      p_conversation_id,
      v_member_id,
      now(),
      now()
    )
    returning id into v_result_id;
  end if;

  return jsonb_build_object('success', true, 'task_id', v_result_id);
end;
$$;

revoke all on function public.upsert_work_task(text, text, timestamptz, uuid, uuid, uuid, uuid) from public, anon, service_role;
grant execute on function public.upsert_work_task(text, text, timestamptz, uuid, uuid, uuid, uuid) to authenticated;

-- 6. RPC para concluir tarefa
create or replace function public.complete_work_task(
    p_task_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_member_id uuid;
begin
  select wm.workspace_id, wm.id into v_workspace_id, v_member_id
  from public.workspace_members wm
  join public.app_users u on u.id = wm.user_id
  where u.auth_user_id = auth.uid()
    and wm.status = 'active'
  limit 1;

  if v_workspace_id is null then
    raise exception 'Sessão inválida ou sem workspace ativo.';
  end if;

  update public.work_tasks
  set status = 'completed',
      completed_at = now(),
      completed_by_member_id = v_member_id,
      updated_at = now()
  where workspace_id = v_workspace_id
    and id = p_task_id;

  return jsonb_build_object('success', true, 'task_id', p_task_id);
end;
$$;

revoke all on function public.complete_work_task(uuid) from public, anon, service_role;
grant execute on function public.complete_work_task(uuid) to authenticated;

-- 7. RPC para atualizar qualificações do contato e oportunidade a partir do painel
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
as $$
declare
  v_workspace_id uuid;
  v_caller_role text;
begin
  select wm.workspace_id, wm.role into v_workspace_id, v_caller_role
  from public.workspace_members wm
  join public.app_users u on u.id = wm.user_id
  where u.auth_user_id = auth.uid()
    and wm.status = 'active'
  limit 1;

  if v_workspace_id is null then
    raise exception 'Sessão inválida ou sem workspace ativo.';
  end if;

  if p_contact_id is not null then
    update public.contacts
    set display_name = coalesce(p_notes, display_name),
        registration_status = 'confirmed',
        updated_at = now()
    where workspace_id = v_workspace_id
      and id = p_contact_id;
  end if;

  if p_opportunity_id is not null then
    update public.opportunities
    set operation_type = coalesce(p_operation_type, operation_type),
        property_type_preference = coalesce(p_property_type_preference, property_type_preference),
        city_region_preference = coalesce(p_city_region_preference, city_region_preference),
        value_range_preference = coalesce(p_max_price_budget::text, value_range_preference),
        down_payment_available = coalesce(p_available_down_payment, down_payment_available),
        timeframe_intent = coalesce(p_timeframe_intent, timeframe_intent),
        -- Trava financeira no SQL: apenas OWNER pode alterar campos de análise financeira
        family_income = case when v_caller_role = 'owner' then coalesce(p_family_income, family_income) else family_income end,
        financial_analysis_status = case when v_caller_role = 'owner' then coalesce(p_financial_analysis_status, financial_analysis_status) else financial_analysis_status end,
        approved_amount = case when v_caller_role = 'owner' then coalesce(p_approved_credit_amount, approved_amount) else approved_amount end,
        documentation_status = case when v_caller_role = 'owner' then coalesce(p_docs_status, documentation_status) else documentation_status end,
        updated_at = now()
    where workspace_id = v_workspace_id
      and id = p_opportunity_id;
  end if;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.update_contact_opportunity_qualification(uuid, uuid, text, text, text, numeric, numeric, text, numeric, text, numeric, text, text) from public, anon, service_role;
grant execute on function public.update_contact_opportunity_qualification(uuid, uuid, text, text, text, numeric, numeric, text, numeric, text, numeric, text, text) to authenticated;

-- 8. Atualização da RPC get_conversations_list com suporte a telefone, contact_id e unread
drop function if exists public.get_conversations_list(text, timestamptz, uuid, int);
create function public.get_conversations_list(
    p_search        text        default null,
    p_cursor_ts     timestamptz default null,
    p_cursor_id     uuid        default null,
    p_limit         int         default 20
)
returns table (
    conversation_id         uuid,
    conversation_type       text,
    visibility              text,
    operational_status      text,
    started_at              timestamptz,
    last_activity_at        timestamptz,
    last_msg_text           text,
    last_msg_direction      text,
    last_msg_occurred_at    timestamptz,
    last_msg_author_name    text,
    participant_name        text,
    participant_phone       text,
    contact_id              uuid,
    is_unread               boolean,
    next_cursor_ts          timestamptz,
    next_cursor_id          uuid
)
language sql
stable
security invoker
set search_path = ''
as $function$
    with bounded_limit as (
        select greatest(1, least(coalesce(p_limit, 20), 100)) as lim
    ),
    caller_member as (
        select wm.workspace_id, wm.id as member_id
        from public.workspace_members wm
        join public.app_users u on u.id = wm.user_id
        where u.auth_user_id = auth.uid()
          and wm.status = 'active'
        limit 1
    ),
    last_message as (
        select
            m.conversation_id,
            m.workspace_id,
            m.text_content  as text_content,
            m.direction     as direction,
            m.occurred_at   as occurred_at,
            m.internal_author_member_id,
            u_author.display_name as author_name
        from public.conversations c
        cross join lateral (
            select
                msg.conversation_id,
                msg.workspace_id,
                msg.text_content,
                msg.direction,
                msg.occurred_at,
                msg.internal_author_member_id
            from public.messages msg
            where msg.workspace_id    = c.workspace_id
              and msg.conversation_id = c.id
            order by msg.occurred_at desc, msg.id desc
            limit 1
        ) m
        left join public.workspace_members wm_author on wm_author.workspace_id = m.workspace_id and wm_author.id = m.internal_author_member_id
        left join public.app_users u_author on u_author.id = wm_author.user_id
    ),
    primary_participant as (
        select distinct on (cp.conversation_id)
            cp.conversation_id,
            cp.workspace_id,
            ct.id as contact_id,
            coalesce(
                ct.display_name,
                cp_point.display_value,
                cp.external_display_name
            ) as resolved_name,
            coalesce(cp_point.display_value, cp_point.normalized_value, '') as resolved_phone
        from public.conversation_participants cp
        left join public.contact_points cp_point
               on cp_point.workspace_id = cp.workspace_id
              and cp_point.id           = cp.contact_point_id
        left join public.contacts ct
               on ct.workspace_id = cp_point.workspace_id
              and ct.id           = cp_point.contact_id
        where cp.left_at is null
        order by cp.conversation_id,
                 (ct.display_name is not null) desc,
                 cp.first_seen_at asc
    ),
    ranked as (
        select
            c.id                                                                    as conversation_id,
            c.conversation_type,
            c.visibility,
            c.operational_status,
            c.started_at,
            coalesce(lm.occurred_at, c.started_at)                                 as last_activity_at,
            lm.text_content                                                         as last_msg_text,
            lm.direction                                                            as last_msg_direction,
            lm.occurred_at                                                          as last_msg_occurred_at,
            lm.author_name                                                          as last_msg_author_name,
            pp.resolved_name                                                        as participant_name,
            pp.resolved_phone                                                       as participant_phone,
            pp.contact_id                                                           as contact_id,
            coalesce(crs.is_unread, false)                                          as is_unread
        from public.conversations c
        left join last_message       lm on lm.workspace_id    = c.workspace_id
                                       and lm.conversation_id = c.id
        left join primary_participant pp on pp.workspace_id    = c.workspace_id
                                         and pp.conversation_id = c.id
        left join caller_member      cm on cm.workspace_id    = c.workspace_id
        left join public.conversation_read_states crs on crs.workspace_id = c.workspace_id
                                                     and crs.conversation_id = c.id
                                                     and crs.member_id = cm.member_id
        where c.archived_at is null
          and (
              p_search is null
              or p_search = ''
              or pp.resolved_name     ilike '%' || p_search || '%'
              or pp.resolved_phone    ilike '%' || p_search || '%'
          )
          and (
              p_cursor_ts is null
              or (coalesce(lm.occurred_at, c.started_at), c.id)
                 < (p_cursor_ts, p_cursor_id)
          )
        order by last_activity_at desc, c.id desc
        limit (select lim from bounded_limit)
    )
    select
        r.conversation_id,
        r.conversation_type,
        r.visibility,
        r.operational_status,
        r.started_at,
        r.last_activity_at,
        r.last_msg_text,
        r.last_msg_direction,
        r.last_msg_occurred_at,
        r.last_msg_author_name,
        r.participant_name,
        r.participant_phone,
        r.contact_id,
        r.is_unread,
        last_value(r.last_activity_at) over w as next_cursor_ts,
        last_value(r.conversation_id)  over w as next_cursor_id
    from ranked r
    window w as (
        rows between unbounded preceding and unbounded following
    );
$function$;

revoke all on function public.get_conversations_list(text, timestamptz, uuid, int)
    from public, anon, service_role;

grant execute on function public.get_conversations_list(text, timestamptz, uuid, int)
    to authenticated;
