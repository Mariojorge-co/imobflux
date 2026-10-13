-- ImobFlux: atribuição de conversa a responsáveis (FLUXOS_NEGOCIO.md, fluxos 18 e 19).
--
-- Atribuição indica responsabilidade operacional: NÃO concede nem restringe acesso (a privacidade vem
-- de private.can_access_conversation) e uma conversa pode ter mais de um responsável. Quem tem acesso
-- comercial à conversa (OWNER ou ATTENDANT ativo do mesmo workspace) atribui, troca e remove.
-- Regras de segurança conservadoras:
--   * o responsável precisa ser membro ATIVO do mesmo workspace;
--   * conversa privada (contato protegido) ou grupo não liberado só pode ser atribuída a OWNER:
--     atribuir a um ATTENDANT entregaria trabalho que ele não pode ver;
--   * toda mudança é auditada com ids de membro apenas (sem conteúdo de conversa);
--   * o histórico é preservado: atribuições encerradas continuam na tabela.

-- A conversa é visível para a equipe (ATTENDANT), independente de quem pergunta?
create or replace function private.is_conversation_team_visible(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
    select exists (
        select 1
        from public.conversations as conversation
        where conversation.id = p_conversation_id
          and (
              (
                  conversation.conversation_type = 'group'
                  and conversation.visibility = 'commercial'
                  and conversation.commercial_visible_from is not null
              )
              or (
                  conversation.conversation_type = 'individual'
                  and exists (
                      select 1
                      from public.conversation_participants as participant
                      join public.contact_points as point
                        on point.workspace_id = participant.workspace_id
                       and point.id = participant.contact_point_id
                      join public.contacts as contact
                        on contact.workspace_id = point.workspace_id
                       and contact.id = point.contact_id
                      where participant.workspace_id = conversation.workspace_id
                        and participant.conversation_id = conversation.id
                        and participant.left_at is null
                        and not contact.is_protected
                        and contact.commercial_visible_from is not null
                  )
              )
          )
    );
$function$;

revoke all on function private.is_conversation_team_visible(uuid) from public, anon, authenticated;

create or replace function public.assign_conversation(p_conversation_id uuid, p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_workspace_id uuid;
    v_actor_member_id uuid;
    v_target_role text;
    v_assignment_id uuid;
    v_now timestamptz := statement_timestamp();
begin
    select conversation.workspace_id into v_workspace_id
    from public.conversations as conversation
    where conversation.id = p_conversation_id;

    select context.member_id into v_actor_member_id
    from private.active_member_context() as context
    where context.workspace_id = v_workspace_id;

    if v_workspace_id is null or v_actor_member_id is null
       or not private.can_access_conversation(p_conversation_id) then
        raise exception 'conversation_not_available' using errcode = '42501';
    end if;

    select member.role into v_target_role
    from public.workspace_members as member
    where member.id = p_member_id
      and member.workspace_id = v_workspace_id
      and member.status = 'active';

    if v_target_role is null then
        raise exception 'assignee_not_active' using errcode = '22023';
    end if;
    if v_target_role = 'attendant' and not private.is_conversation_team_visible(p_conversation_id) then
        raise exception 'assignee_cannot_access_conversation' using errcode = '22023';
    end if;

    insert into public.conversation_assignments (
        workspace_id, conversation_id, member_id, assigned_by_member_id, assigned_at
    )
    values (v_workspace_id, p_conversation_id, p_member_id, v_actor_member_id, v_now)
    on conflict (conversation_id, member_id) where ended_at is null do nothing
    returning id into v_assignment_id;

    if v_assignment_id is null then
        return jsonb_build_object('success', true, 'status', 'unchanged');
    end if;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type,
        target_id, result, metadata, occurred_at, recorded_at
    ) values (
        v_workspace_id, 'member', v_actor_member_id, 'conversation.assigned', 'conversation',
        p_conversation_id, 'success', jsonb_build_object('member_id', p_member_id), v_now, v_now
    );

    return jsonb_build_object('success', true, 'status', 'assigned', 'assignment_id', v_assignment_id);
end;
$function$;

create or replace function public.unassign_conversation(p_conversation_id uuid, p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_workspace_id uuid;
    v_actor_member_id uuid;
    v_ended integer;
    v_now timestamptz := statement_timestamp();
begin
    select conversation.workspace_id into v_workspace_id
    from public.conversations as conversation
    where conversation.id = p_conversation_id;

    select context.member_id into v_actor_member_id
    from private.active_member_context() as context
    where context.workspace_id = v_workspace_id;

    if v_workspace_id is null or v_actor_member_id is null
       or not private.can_access_conversation(p_conversation_id) then
        raise exception 'conversation_not_available' using errcode = '42501';
    end if;

    update public.conversation_assignments
    set ended_at = greatest(v_now, assigned_at),
        ended_by_member_id = v_actor_member_id,
        end_reason = 'unassigned'
    where workspace_id = v_workspace_id
      and conversation_id = p_conversation_id
      and member_id = p_member_id
      and ended_at is null;
    get diagnostics v_ended = row_count;

    if v_ended = 0 then
        raise exception 'assignment_not_found' using errcode = '55000';
    end if;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type,
        target_id, result, metadata, occurred_at, recorded_at
    ) values (
        v_workspace_id, 'member', v_actor_member_id, 'conversation.unassigned', 'conversation',
        p_conversation_id, 'success', jsonb_build_object('member_id', p_member_id, 'reason', 'unassigned'), v_now, v_now
    );

    return jsonb_build_object('success', true, 'status', 'unassigned');
end;
$function$;

-- Troca de responsável: encerra a atribuição de p_from e cria a de p_to (se já for responsável, só encerra).
create or replace function public.reassign_conversation(
    p_conversation_id uuid,
    p_from_member_id uuid,
    p_to_member_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_workspace_id uuid;
    v_actor_member_id uuid;
    v_target_role text;
    v_ended integer;
    v_new_assignment_id uuid;
    v_now timestamptz := statement_timestamp();
begin
    select conversation.workspace_id into v_workspace_id
    from public.conversations as conversation
    where conversation.id = p_conversation_id;

    select context.member_id into v_actor_member_id
    from private.active_member_context() as context
    where context.workspace_id = v_workspace_id;

    if v_workspace_id is null or v_actor_member_id is null
       or not private.can_access_conversation(p_conversation_id) then
        raise exception 'conversation_not_available' using errcode = '42501';
    end if;

    if p_from_member_id is null or p_to_member_id is null or p_from_member_id = p_to_member_id then
        raise exception 'assignment_invalid' using errcode = '22023';
    end if;

    select member.role into v_target_role
    from public.workspace_members as member
    where member.id = p_to_member_id
      and member.workspace_id = v_workspace_id
      and member.status = 'active';

    if v_target_role is null then
        raise exception 'assignee_not_active' using errcode = '22023';
    end if;
    if v_target_role = 'attendant' and not private.is_conversation_team_visible(p_conversation_id) then
        raise exception 'assignee_cannot_access_conversation' using errcode = '22023';
    end if;

    update public.conversation_assignments
    set ended_at = greatest(v_now, assigned_at),
        ended_by_member_id = v_actor_member_id,
        end_reason = 'reassigned'
    where workspace_id = v_workspace_id
      and conversation_id = p_conversation_id
      and member_id = p_from_member_id
      and ended_at is null;
    get diagnostics v_ended = row_count;

    if v_ended = 0 then
        raise exception 'assignment_not_found' using errcode = '55000';
    end if;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type,
        target_id, result, metadata, occurred_at, recorded_at
    ) values (
        v_workspace_id, 'member', v_actor_member_id, 'conversation.unassigned', 'conversation',
        p_conversation_id, 'success',
        jsonb_build_object('member_id', p_from_member_id, 'reason', 'reassigned', 'to_member_id', p_to_member_id),
        v_now, v_now
    );

    insert into public.conversation_assignments (
        workspace_id, conversation_id, member_id, assigned_by_member_id, assigned_at
    )
    values (v_workspace_id, p_conversation_id, p_to_member_id, v_actor_member_id, v_now)
    on conflict (conversation_id, member_id) where ended_at is null do nothing
    returning id into v_new_assignment_id;

    if v_new_assignment_id is not null then
        insert into public.audit_events (
            workspace_id, actor_type, actor_member_id, action, target_type,
            target_id, result, metadata, occurred_at, recorded_at
        ) values (
            v_workspace_id, 'member', v_actor_member_id, 'conversation.assigned', 'conversation',
            p_conversation_id, 'success',
            jsonb_build_object('member_id', p_to_member_id, 'from_member_id', p_from_member_id),
            v_now, v_now
        );
    end if;

    return jsonb_build_object('success', true, 'status', 'reassigned');
end;
$function$;

-- Nome de exibição de um membro do MESMO workspace do chamador. Colegas (ATTENDANT) não leem a tabela de
-- membros pela RLS, mas precisam ver quem é o responsável; só o nome é exposto, nunca e-mail ou papel.
create or replace function private.member_display_name(p_workspace_id uuid, p_member_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
    select app_user.display_name
    from public.workspace_members as member
    join public.app_users as app_user on app_user.id = member.user_id
    where member.id = p_member_id
      and member.workspace_id = p_workspace_id
      and exists (
          select 1 from private.active_member_context() as context
          where context.workspace_id = p_workspace_id
      );
$function$;

revoke all on function private.member_display_name(uuid, uuid) from public, anon, authenticated;
-- A lista de conversas é SECURITY INVOKER e chama esta função; ela só devolve nomes do próprio workspace do chamador.
grant execute on function private.member_display_name(uuid, uuid) to authenticated;

-- Membros ativos do workspace do chamador, para escolher responsável (qualquer membro ativo pode ler).
create or replace function public.get_member_directory()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
    select coalesce(
        jsonb_agg(
            jsonb_build_object('member_id', member.id, 'display_name', app_user.display_name, 'role', member.role)
            order by case member.role when 'owner' then 0 else 1 end, app_user.display_name, member.id
        ),
        '[]'::jsonb
    )
    from private.active_member_context() as context
    join public.workspace_members as member on member.workspace_id = context.workspace_id
    join public.app_users as app_user on app_user.id = member.user_id
    where member.status = 'active';
$function$;

-- Responsáveis atuais de uma conversa. Só para quem tem acesso à conversa; respeita o marco temporal
-- de visibilidade (como a RLS de conversation_assignments).
create or replace function public.get_conversation_assignees(p_conversation_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
    select case
        when private.can_access_conversation(p_conversation_id) then coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'member_id', assignment.member_id,
                    'display_name', private.member_display_name(assignment.workspace_id, assignment.member_id),
                    'assigned_at', assignment.assigned_at
                ) order by assignment.assigned_at, assignment.id
            )
            from public.conversation_assignments as assignment
            where assignment.conversation_id = p_conversation_id
              and assignment.ended_at is null
              and private.can_access_conversation_event(assignment.conversation_id, assignment.assigned_at)
        ), '[]'::jsonb)
        else '[]'::jsonb
    end;
$function$;

alter function public.assign_conversation(uuid, uuid) owner to postgres;
alter function public.unassign_conversation(uuid, uuid) owner to postgres;
alter function public.reassign_conversation(uuid, uuid, uuid) owner to postgres;
revoke all on function public.assign_conversation(uuid, uuid) from public, anon, authenticated;
revoke all on function public.unassign_conversation(uuid, uuid) from public, anon, authenticated;
revoke all on function public.reassign_conversation(uuid, uuid, uuid) from public, anon, authenticated;
alter function public.get_conversation_assignees(uuid) owner to postgres;
alter function public.get_member_directory() owner to postgres;
revoke all on function public.get_conversation_assignees(uuid) from public, anon, service_role;
revoke all on function public.get_member_directory() from public, anon, service_role;
grant execute on function public.assign_conversation(uuid, uuid) to authenticated;
grant execute on function public.unassign_conversation(uuid, uuid) to authenticated;
grant execute on function public.reassign_conversation(uuid, uuid, uuid) to authenticated;
grant execute on function public.get_conversation_assignees(uuid) to authenticated;
grant execute on function public.get_member_directory() to authenticated;

-- ─── Lista de conversas: responsáveis, "minhas" e contador ─────────────────────────────────────
create or replace function public.get_conversations_inbox(
    p_view text default 'all',
    p_search text default null,
    p_cursor_ts timestamptz default null,
    p_cursor_id uuid default null,
    p_limit integer default 20
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
    with caller as (
        select context.member_id, context.workspace_id, context.member_role
        from private.active_member_context() as context
    ),
    authorized_conversations as (
        select conversation.*
        from public.conversations as conversation
        join caller on caller.workspace_id = conversation.workspace_id
    ),
    projected as (
        select
            conversation.id as conversation_id,
            conversation.conversation_type,
            conversation.visibility,
            conversation.operational_status,
            conversation.archived_at,
            conversation.started_at,
            case
                when conversation.conversation_type = 'group'
                    then coalesce(conversation.subject, 'Grupo WhatsApp')
                else individual_contact.display_name
            end as participant_name,
            case when conversation.conversation_type = 'individual' then point.display_value end as participant_phone,
            case when conversation.conversation_type = 'individual' then individual_contact.id end as contact_id,
            case when conversation.conversation_type = 'individual' and point.external_avatar_url is not null
                 then '/api/contact-avatar/' || point.id::text end as avatar_url,
            last_message.text_content as last_msg_text,
            case when last_message.is_history then null else last_message.direction end as last_msg_direction,
            last_message.occurred_at as last_msg_occurred_at,
            case
                when last_message.internal_author_member_id is not null then author_user.display_name
                when conversation.conversation_type = 'group' then group_sender.external_display_name
                else null
            end as last_msg_author_name,
            coalesce(
                last_message.occurred_at,
                case when caller.member_role = 'attendant' then conversation.commercial_visible_from end,
                conversation.started_at
            ) as last_activity_at,
            (
                coalesce(read_state.is_unread, false)
                or exists (
                    select 1
                    from public.messages as unread_message
                    where unread_message.workspace_id = conversation.workspace_id
                      and unread_message.conversation_id = conversation.id
                      and unread_message.direction = 'incoming'
                      and not unread_message.is_history
                      and unread_message.occurred_at > coalesce(read_state.last_read_at, '-infinity'::timestamptz)
                )
            ) as is_unread,
            assignment_info.assignees,
            assignment_info.assigned_to_me
        from authorized_conversations as conversation
        join caller on caller.workspace_id = conversation.workspace_id
        left join lateral (
            select
                coalesce(
                    jsonb_agg(
                        jsonb_build_object('member_id', assignment.member_id, 'display_name', private.member_display_name(assignment.workspace_id, assignment.member_id))
                        order by assignment.assigned_at, assignment.id
                    ),
                    '[]'::jsonb
                ) as assignees,
                coalesce(bool_or(assignment.member_id = caller.member_id), false) as assigned_to_me
            from public.conversation_assignments as assignment
            where assignment.workspace_id = conversation.workspace_id
              and assignment.conversation_id = conversation.id
              and assignment.ended_at is null
        ) as assignment_info on true
        left join lateral (
            select participant.contact_point_id
            from public.conversation_participants as participant
            where participant.workspace_id = conversation.workspace_id
              and participant.conversation_id = conversation.id
              and participant.left_at is null
            order by participant.first_seen_at, participant.id
            limit 1
        ) as primary_participant on true
        left join public.contact_points as point
          on point.workspace_id = conversation.workspace_id
         and point.id = primary_participant.contact_point_id
        left join public.contacts as individual_contact
          on individual_contact.workspace_id = point.workspace_id
         and individual_contact.id = point.contact_id
        left join lateral (
            select message.*
            from public.messages as message
            where message.workspace_id = conversation.workspace_id
              and message.conversation_id = conversation.id
            order by message.occurred_at desc, message.id desc
            limit 1
        ) as last_message on true
        left join public.workspace_members as author_member
          on author_member.workspace_id = last_message.workspace_id
         and author_member.id = last_message.internal_author_member_id
        left join public.app_users as author_user
          on author_user.id = author_member.user_id
        left join public.conversation_participants as group_sender
          on group_sender.workspace_id = last_message.workspace_id
         and group_sender.conversation_id = last_message.conversation_id
         and group_sender.contact_point_id = last_message.sender_contact_point_id
         and group_sender.left_at is null
        left join public.conversation_read_states as read_state
          on read_state.workspace_id = conversation.workspace_id
         and read_state.conversation_id = conversation.id
         and read_state.member_id = caller.member_id
    ),
    searched as (
        select *
        from projected
        where p_search is null
           or btrim(p_search) = ''
           or participant_name ilike '%' || btrim(p_search) || '%'
           or participant_phone ilike '%' || btrim(p_search) || '%'
    ),
    filtered as (
        select *
        from searched
        where case coalesce(p_view, 'all')
            when 'archived' then archived_at is not null
            when 'unread' then archived_at is null and is_unread
            when 'groups' then archived_at is null and conversation_type = 'group'
            when 'mine' then archived_at is null and assigned_to_me
            else archived_at is null
        end
          and (
              p_cursor_ts is null
              or (last_activity_at, conversation_id) < (p_cursor_ts, p_cursor_id)
          )
        order by last_activity_at desc, conversation_id desc
        limit greatest(1, least(coalesce(p_limit, 20), 100))
    ),
    counts as (
        select
            count(*) filter (where archived_at is null) as all_count,
            count(*) filter (where archived_at is null and is_unread) as unread_count,
            count(*) filter (where archived_at is null and conversation_type = 'group') as group_count,
            count(*) filter (where archived_at is null and assigned_to_me) as mine_count,
            count(*) filter (where archived_at is not null) as archived_count,
            count(*) filter (where archived_at is not null and is_unread) as archived_unread_count
        from projected
    )
    select jsonb_build_object(
        'items', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'conversation_id', item.conversation_id,
                    'conversation_type', item.conversation_type,
                    'visibility', item.visibility,
                    'operational_status', item.operational_status,
                    'archived_at', item.archived_at,
                    'started_at', item.started_at,
                    'last_activity_at', item.last_activity_at,
                    'last_msg_text', item.last_msg_text,
                    'last_msg_direction', item.last_msg_direction,
                    'last_msg_occurred_at', item.last_msg_occurred_at,
                    'last_msg_author_name', item.last_msg_author_name,
                    'participant_name', item.participant_name,
                    'participant_phone', item.participant_phone,
                    'contact_id', item.contact_id,
                    'avatar_url', item.avatar_url,
                    'is_unread', item.is_unread,
                    'assignees', item.assignees,
                    'assigned_to_me', item.assigned_to_me
                ) order by item.last_activity_at desc, item.conversation_id desc
            )
            from filtered as item
        ), '[]'::jsonb),
        'counts', (
            select jsonb_build_object(
                'all', counts.all_count,
                'unread', counts.unread_count,
                'groups', counts.group_count,
                'mine', counts.mine_count,
                'archived', counts.archived_count,
                'archived_unread', counts.archived_unread_count
            )
            from counts
        )
    );
$function$;

revoke all on function public.get_conversations_inbox(text, text, timestamptz, uuid, integer)
from public, anon, service_role;
grant execute on function public.get_conversations_inbox(text, text, timestamptz, uuid, integer)
to authenticated;
