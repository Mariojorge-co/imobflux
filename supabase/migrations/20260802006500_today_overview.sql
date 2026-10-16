-- ImobFlux: painel "Hoje". UMA função de leitura nova (nada existente muda), que devolve o que as listas do painel precisam e que
-- as funções atuais não trazem juntas: as conversas com prazo (as mesmas de get_sla_conversations) COM os responsáveis e se a
-- equipe já respondeu alguma vez, mais os contadores do dia.
--
-- SECURITY INVOKER: roda como a pessoa logada, então a RLS decide o que ela vê (privacidade de contato, grupo liberado,
-- contato protegido). A regra do prazo continua em private.sla_applies e no cálculo único do app (calculateSLA): aqui só se
-- entregam os dados. Somente leitura, sem nenhuma escrita.
--   conversations: igual a get_sla_conversations + assignees, assigned_to_me, has_outgoing
--   counters: mensagens recebidas e enviadas hoje, conversas novas hoje e tarefas concluídas hoje (dia no fuso do workspace)

create or replace function public.get_today_overview(p_limit integer default 500)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
    with caller as (
        select context.member_id, context.workspace_id
        from private.active_member_context() as context
    ),
    zone as (
        select
            workspace.timezone,
            (date_trunc('day', statement_timestamp() at time zone workspace.timezone) at time zone workspace.timezone) as day_start
        from public.workspaces as workspace
        join caller on caller.workspace_id = workspace.id
    ),
    base as (
        select
            conversation.id as conversation_id,
            conversation.workspace_id,
            conversation.started_at,
            individual_contact.id as contact_id,
            individual_contact.display_name as participant_name,
            sla_message.direction as sla_direction,
            sla_message.occurred_at as sla_at
        from public.conversations as conversation
        join caller on caller.workspace_id = conversation.workspace_id
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
        join lateral (
            select message.direction, message.occurred_at, message.is_history
            from public.messages as message
            where message.workspace_id = conversation.workspace_id
              and message.conversation_id = conversation.id
              and message.status is distinct from 'failed'
            order by message.occurred_at desc, message.id desc
            limit 1
        ) as sla_message on not sla_message.is_history
        where conversation.conversation_type = 'individual'
          and conversation.archived_at is null
          and conversation.operational_status = 'active'
          and private.sla_applies(conversation.id)
        order by sla_message.occurred_at asc, conversation.id asc
        limit greatest(1, least(coalesce(p_limit, 500), 1000))
    ),
    enriched as (
        select
            base.*,
            assignment_info.assignees,
            assignment_info.assigned_to_me,
            exists (
                select 1
                from public.messages as outgoing
                where outgoing.workspace_id = base.workspace_id
                  and outgoing.conversation_id = base.conversation_id
                  and outgoing.direction = 'outgoing'
                  and not outgoing.is_history
                  and outgoing.status is distinct from 'failed'
            ) as has_outgoing
        from base
        join caller on caller.workspace_id = base.workspace_id
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
            where assignment.workspace_id = base.workspace_id
              and assignment.conversation_id = base.conversation_id
              and assignment.ended_at is null
        ) as assignment_info on true
    )
    select jsonb_build_object(
        'timezone', (select zone.timezone from zone),
        'day_start', (select zone.day_start from zone),
        'conversations', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'conversation_id', enriched.conversation_id,
                    'contact_id', enriched.contact_id,
                    'participant_name', enriched.participant_name,
                    'started_at', enriched.started_at,
                    'sla_direction', enriched.sla_direction,
                    'sla_at', enriched.sla_at,
                    'assignees', enriched.assignees,
                    'assigned_to_me', enriched.assigned_to_me,
                    'has_outgoing', enriched.has_outgoing
                ) order by enriched.sla_at asc, enriched.conversation_id asc
            )
            from enriched
        ), '[]'::jsonb),
        'counters', jsonb_build_object(
            'incoming_today', (
                select count(*)
                from public.messages as message, zone
                where message.direction = 'incoming' and not message.is_history and message.hidden_at is null
                  and message.occurred_at >= zone.day_start
            ),
            'outgoing_today', (
                select count(*)
                from public.messages as message, zone
                where message.direction = 'outgoing' and message.origin = 'crm' and not message.is_history
                  and message.status is distinct from 'failed' and message.hidden_at is null
                  and message.occurred_at >= zone.day_start
            ),
            'new_conversations_today', (
                select count(*)
                from public.conversations as conversation, zone
                where conversation.conversation_type = 'individual' and conversation.started_at >= zone.day_start
            ),
            'tasks_completed_today', (
                select count(*)
                from public.work_tasks as task, zone
                where task.status = 'completed' and task.completed_at >= zone.day_start
            )
        )
    );
$function$;

alter function public.get_today_overview(integer) owner to postgres;
revoke all on function public.get_today_overview(integer) from public, anon, service_role;
grant execute on function public.get_today_overview(integer) to authenticated;
