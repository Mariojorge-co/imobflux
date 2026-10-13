-- Bloco 3: o quadro Kanban passa a trazer direção e hora da última mensagem da conversa vinculada,
-- para exibir o SLA (quem deve resposta) no card. Security invoker: a RLS de messages continua valendo.

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
            lm.direction as last_msg_direction,
            lm.occurred_at as last_msg_at,
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
        left join lateral (
            select msg.direction, msg.occurred_at
            from public.messages msg
            where msg.conversation_id = oc_link.conversation_id
              and msg.workspace_id = o.workspace_id
            order by msg.occurred_at desc, msg.id desc
            limit 1
        ) lm on oc_link.conversation_id is not null
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
                'linked_conversation_id', ro.linked_conversation_id,
                'last_msg_direction', ro.last_msg_direction,
                'last_msg_at', ro.last_msg_at
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
