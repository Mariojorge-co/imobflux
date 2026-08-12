-- Hotfix: colaboração OWNER/ATTENDANT, leitura autoritativa de notas,
-- edição contextual do contato e follow-ups do dia corrente.

create or replace function public.queue_outgoing_text_message(
    p_conversation_id uuid,
    p_text_content text,
    p_client_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_context record;
    v_existing_message_id uuid;
    v_existing_status text;
    v_channel_connection_id uuid;
    v_external_thread_id text;
    v_message_id uuid;
begin
    select * into v_context
    from private.active_member_context()
    limit 1;

    if v_context.member_id is null then
        raise exception 'message_enqueue_not_authorized' using errcode = '42501';
    end if;

    if p_client_idempotency_key is null then
        raise exception 'invalid_idempotency_key' using errcode = '22023';
    end if;

    select message.id, message.status
    into v_existing_message_id, v_existing_status
    from public.messages as message
    where message.workspace_id = v_context.workspace_id
      and message.client_idempotency_key = p_client_idempotency_key;

    if v_existing_message_id is not null then
        return jsonb_build_object(
            'status', 'duplicate',
            'message_id', v_existing_message_id,
            'message_status', v_existing_status
        );
    end if;

    select conversation.channel_connection_id, conversation.external_thread_id
    into v_channel_connection_id, v_external_thread_id
    from public.conversations as conversation
    where conversation.workspace_id = v_context.workspace_id
      and conversation.id = p_conversation_id
      and conversation.operational_status = 'active';

    if v_channel_connection_id is null then
        raise exception 'conversation_not_available' using errcode = '42704';
    end if;

    if not private.can_access_conversation(p_conversation_id) then
        raise exception 'message_enqueue_not_authorized' using errcode = '42501';
    end if;

    if nullif(btrim(p_text_content), '') is null then
        raise exception 'message_content_empty' using errcode = '22023';
    end if;

    insert into public.messages (
        workspace_id, channel_connection_id, conversation_id, direction,
        origin, status, sender_contact_point_id, internal_author_member_id,
        client_idempotency_key, text_content, occurred_at
    ) values (
        v_context.workspace_id, v_channel_connection_id, p_conversation_id,
        'outgoing', 'crm', 'queued', null, v_context.member_id,
        p_client_idempotency_key, p_text_content, statement_timestamp()
    ) returning id into v_message_id;

    return jsonb_build_object(
        'status', 'queued',
        'message_id', v_message_id,
        'conversation_id', p_conversation_id,
        'channel_connection_id', v_channel_connection_id,
        'recipient_target', v_external_thread_id
    );
exception
    when unique_violation then
        select message.id, message.status
        into v_existing_message_id, v_existing_status
        from public.messages as message
        where message.workspace_id = v_context.workspace_id
          and message.client_idempotency_key = p_client_idempotency_key;

        if v_existing_message_id is not null then
            return jsonb_build_object(
                'status', 'duplicate',
                'message_id', v_existing_message_id,
                'message_status', v_existing_status
            );
        end if;
        raise;
end;
$function$;

alter function public.queue_outgoing_text_message(uuid, text, uuid) owner to postgres;
revoke all on function public.queue_outgoing_text_message(uuid, text, uuid) from public, anon, service_role;
grant execute on function public.queue_outgoing_text_message(uuid, text, uuid) to authenticated;

create or replace function public.save_internal_note(
    p_conversation_id uuid,
    p_content text,
    p_opportunity_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_context record;
    v_contact_id uuid;
    v_opportunity_contact_id uuid;
    v_note_id uuid;
    v_content text := btrim(p_content);
    v_created_at timestamptz := statement_timestamp();
    v_author_name text;
begin
    select * into v_context from private.active_member_context() limit 1;
    if v_context.member_id is null or not private.can_access_conversation(p_conversation_id) then
        raise exception 'resource_not_available' using errcode = '42501';
    end if;
    if nullif(v_content, '') is null then
        raise exception 'internal_note_content_empty' using errcode = '22023';
    end if;

    select contact.id into v_contact_id
    from public.conversations as conversation
    join public.conversation_participants as participant
      on participant.workspace_id = conversation.workspace_id
     and participant.conversation_id = conversation.id
     and participant.left_at is null
    join public.contact_points as point
      on point.workspace_id = participant.workspace_id
     and point.id = participant.contact_point_id
    join public.contacts as contact
      on contact.workspace_id = point.workspace_id
     and contact.id = point.contact_id
    where conversation.id = p_conversation_id
      and conversation.workspace_id = v_context.workspace_id
      and conversation.conversation_type = 'individual'
    order by participant.first_seen_at, participant.id
    limit 1;

    if p_opportunity_id is not null then
        select opportunity.contact_id into v_opportunity_contact_id
        from public.opportunities as opportunity
        where opportunity.id = p_opportunity_id
          and opportunity.workspace_id = v_context.workspace_id;

        if v_opportunity_contact_id is null then
            raise exception 'Oportunidade não encontrada no workspace da conversa.';
        end if;
        if v_contact_id is null or v_opportunity_contact_id <> v_contact_id then
            raise exception 'Oportunidade não pertence ao contato da conversa.';
        end if;
        if not private.can_access_opportunity(p_opportunity_id) then
            raise exception 'resource_not_available' using errcode = '42501';
        end if;
    end if;

    select app_user.display_name into v_author_name
    from public.workspace_members as member
    join public.app_users as app_user on app_user.id = member.user_id
    where member.id = v_context.member_id;

    insert into public.internal_notes (
        workspace_id, conversation_id, opportunity_id, author_member_id,
        content, created_at, updated_at
    ) values (
        v_context.workspace_id, p_conversation_id, p_opportunity_id,
        v_context.member_id, v_content, v_created_at, v_created_at
    ) returning id into v_note_id;

    return jsonb_build_object(
        'success', true,
        'note_id', v_note_id,
        'note', jsonb_build_object(
            'id', v_note_id,
            'content', v_content,
            'created_at', v_created_at,
            'author_name', coalesce(v_author_name, 'Usuário')
        )
    );
end;
$function$;

alter function public.save_internal_note(uuid, text, uuid) owner to postgres;
revoke all on function public.save_internal_note(uuid, text, uuid) from public, anon, service_role;
grant execute on function public.save_internal_note(uuid, text, uuid) to authenticated;

create or replace function public.get_visible_internal_notes(
    p_conversation_id uuid,
    p_opportunity_id uuid default null
) returns table (
    id uuid,
    content text,
    created_at timestamptz,
    author_name text,
    opportunity_id uuid
)
language sql
stable
security definer
set search_path = ''
as $function$
    select
        note.id,
        note.content,
        note.created_at,
        coalesce(app_user.display_name, 'Usuário') as author_name,
        note.opportunity_id
    from public.internal_notes as note
    left join public.workspace_members as author on author.id = note.author_member_id
    left join public.app_users as app_user on app_user.id = author.user_id
    where private.can_access_conversation(p_conversation_id)
      and private.can_access_internal_note(note.id)
      and note.archived_at is null
      and note.conversation_id = p_conversation_id
      and (
          note.opportunity_id is null
          or (p_opportunity_id is not null and note.opportunity_id = p_opportunity_id)
      )
    order by note.created_at desc, note.id desc;
$function$;

alter function public.get_visible_internal_notes(uuid, uuid) owner to postgres;
revoke all on function public.get_visible_internal_notes(uuid, uuid) from public, anon, service_role;
grant execute on function public.get_visible_internal_notes(uuid, uuid) to authenticated;

create or replace function public.update_conversation_contact_name(
    p_conversation_id uuid,
    p_display_name text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_context record;
    v_contact_id uuid;
    v_display_name text := btrim(p_display_name);
    v_registration_status text;
    v_now timestamptz := statement_timestamp();
begin
    select * into v_context from private.active_member_context() limit 1;
    if v_context.member_id is null or not private.can_access_conversation(p_conversation_id) then
        raise exception 'resource_not_available' using errcode = '42501';
    end if;
    if v_display_name is null or char_length(v_display_name) < 2 or char_length(v_display_name) > 120 then
        raise exception 'contact_display_name_invalid' using errcode = '22023';
    end if;

    select contact.id into v_contact_id
    from public.conversations as conversation
    join public.conversation_participants as participant
      on participant.workspace_id = conversation.workspace_id
     and participant.conversation_id = conversation.id
     and participant.left_at is null
    join public.contact_points as point
      on point.workspace_id = participant.workspace_id
     and point.id = participant.contact_point_id
    join public.contacts as contact
      on contact.workspace_id = point.workspace_id
     and contact.id = point.contact_id
    where conversation.id = p_conversation_id
      and conversation.workspace_id = v_context.workspace_id
      and conversation.conversation_type = 'individual'
    order by participant.first_seen_at, participant.id
    limit 1
    for update of contact;

    if v_contact_id is null or not private.can_access_contact(v_contact_id) then
        raise exception 'resource_not_available' using errcode = '42501';
    end if;

    update public.contacts
    set display_name = v_display_name,
        registration_status = case
            when registration_status = 'provisional' then 'confirmed'
            else registration_status
        end,
        updated_at = v_now
    where id = v_contact_id
      and workspace_id = v_context.workspace_id
    returning registration_status into v_registration_status;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type,
        target_id, result, metadata, occurred_at, recorded_at
    ) values (
        v_context.workspace_id, 'member', v_context.member_id,
        'contact.display_name_updated', 'contact', v_contact_id, 'success',
        jsonb_build_object('registration_status', v_registration_status), v_now, v_now
    );

    return jsonb_build_object(
        'success', true,
        'contact_id', v_contact_id,
        'display_name', v_display_name,
        'registration_status', v_registration_status
    );
end;
$function$;

alter function public.update_conversation_contact_name(uuid, text) owner to postgres;
revoke all on function public.update_conversation_contact_name(uuid, text) from public, anon, service_role;
grant execute on function public.update_conversation_contact_name(uuid, text) to authenticated;

create or replace function public.get_prioridades_dashboard()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
    with visible_contacts as (
        select contact.*, conversation.id as conversation_id
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
        select task.*,
               coalesce(task.contact_id, opportunity.contact_id, point.contact_id) as resolved_contact_id,
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
        where task.task_type = 'follow_up'
          and task.status = 'pending'
          and task.archived_at is null
          and (task.due_at at time zone 'America/Sao_Paulo')::date
              <= (statement_timestamp() at time zone 'America/Sao_Paulo')::date
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
            'opportunity_id', followup.opportunity_id,
            'display_name', contact.display_name
        ) order by followup.due_at, followup.id)
        from due_followups as followup
        join public.contacts as contact on contact.id = followup.resolved_contact_id), '[]'::jsonb)
    );
$function$;

revoke all on function public.get_prioridades_dashboard() from public, anon, service_role;
grant execute on function public.get_prioridades_dashboard() to authenticated;
