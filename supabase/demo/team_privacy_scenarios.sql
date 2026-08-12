-- Local-only fixtures for manual OWNER x ATTENDANT validation.
set search_path to public, extensions, pg_catalog;

do $$
declare
  v_workspace_id uuid;
  v_owner_member_id uuid;
  v_attendant_member_id uuid := '22222222-2222-4000-8000-222222222224';
  v_channel_id uuid := 'd3300000-0000-4000-8000-000000000001';
  v_now timestamptz := statement_timestamp();
begin
  select workspace.id, member.id
  into v_workspace_id, v_owner_member_id
  from public.workspaces as workspace
  join public.workspace_members as member
    on member.workspace_id = workspace.id
   and member.role = 'owner'
   and member.status = 'active'
  limit 1;

  update public.contacts
  set display_name = case id
      when 'd3300001-0000-4000-8000-000000000001' then 'DEMO — Cliente Público'
      when 'd3300001-0000-4000-8000-000000000002' then 'DEMO — Cliente Privado'
      when 'd3300001-0000-4000-8000-000000000003' then 'DEMO — Cliente Liberado Agora'
      else display_name
    end,
    is_protected = id = 'd3300001-0000-4000-8000-000000000002',
    protected_at = case when id = 'd3300001-0000-4000-8000-000000000002' then v_now else null end,
    commercial_visible_from = case
      when id = 'd3300001-0000-4000-8000-000000000002' then null
      when id = 'd3300001-0000-4000-8000-000000000003' then v_now - interval '1 hour'
      else created_at
    end
  where id between 'd3300001-0000-4000-8000-000000000001'
               and 'd3300001-0000-4000-8000-000000000020';

  update public.contact_points as point
  set is_protected = contact.is_protected,
      protected_at = contact.protected_at,
      commercial_visible_from = case
        when contact.commercial_visible_from is null then null
        else greatest(contact.commercial_visible_from, point.created_at)
      end
  from public.contacts as contact
  where point.workspace_id = contact.workspace_id
    and point.contact_id = contact.id
    and contact.id between 'd3300001-0000-4000-8000-000000000001'
                       and 'd3300001-0000-4000-8000-000000000020';

  update public.conversations as conversation
  set visibility = case when contact.is_protected then 'owner_only' else 'commercial' end,
      commercial_visible_from = case
        when contact.is_protected then null
        when contact.id = 'd3300001-0000-4000-8000-000000000003' then v_now - interval '1 hour'
        else conversation.started_at
      end,
      privacy_changed_at = v_now
  from public.conversation_participants as participant
  join public.contact_points as point
    on point.workspace_id = participant.workspace_id
   and point.id = participant.contact_point_id
  join public.contacts as contact
    on contact.workspace_id = point.workspace_id
   and contact.id = point.contact_id
  where conversation.workspace_id = participant.workspace_id
    and conversation.id = participant.conversation_id
    and conversation.conversation_type = 'individual';

  insert into public.messages (
    id, workspace_id, channel_connection_id, conversation_id, external_message_id,
    direction, origin, sender_contact_point_id, text_content, status,
    occurred_at, external_created_at, received_at, created_at
  ) values (
    'd3400007-0000-4000-8000-000000000001', v_workspace_id, v_channel_id,
    'd3300003-0000-4000-8000-000000000003', 'demo-released-after-cutoff',
    'incoming', 'whatsapp', 'd3300004-0000-4000-8000-000000000003',
    'DEMO — Mensagem posterior à liberação', 'received', v_now - interval '30 minutes',
    v_now - interval '30 minutes', v_now - interval '30 minutes', v_now - interval '30 minutes'
  ) on conflict do nothing;

  insert into public.conversations (
    id, workspace_id, channel_connection_id, external_thread_id, conversation_type,
    operational_status, visibility, commercial_visible_from, subject, started_at,
    privacy_changed_at, created_at, updated_at
  ) values
    (
      'd3300003-0000-4000-8000-000000000021', v_workspace_id, v_channel_id,
      'demo-private-group@g.us', 'group', 'active', 'owner_only', null,
      'DEMO — Grupo Privado', v_now - interval '2 hours', v_now,
      v_now - interval '2 hours', v_now
    ),
    (
      'd3300003-0000-4000-8000-000000000022', v_workspace_id, v_channel_id,
      'demo-team-group@g.us', 'group', 'active', 'commercial', v_now - interval '1 hour',
      'DEMO — Grupo Equipe', v_now - interval '2 hours', v_now - interval '1 hour',
      v_now - interval '2 hours', v_now
    )
  on conflict (channel_connection_id, external_thread_id) do nothing;

  insert into public.conversation_participants (
    id, workspace_id, conversation_id, contact_point_id, external_display_name,
    first_seen_at, created_at
  ) values
    ('d3400006-0000-4000-8000-000000000001', v_workspace_id, 'd3300003-0000-4000-8000-000000000021', 'd3300004-0000-4000-8000-000000000001', 'Participante do grupo privado', v_now - interval '2 hours', v_now - interval '2 hours'),
    ('d3400006-0000-4000-8000-000000000002', v_workspace_id, 'd3300003-0000-4000-8000-000000000022', 'd3300004-0000-4000-8000-000000000002', 'DEMO — Participante Privado', v_now - interval '2 hours', v_now - interval '2 hours')
  on conflict do nothing;

  insert into public.messages (
    id, workspace_id, channel_connection_id, conversation_id, external_message_id,
    direction, origin, sender_contact_point_id, text_content, status,
    occurred_at, external_created_at, received_at, created_at
  ) values
    ('d3400007-0000-4000-8000-000000000002', v_workspace_id, v_channel_id, 'd3300003-0000-4000-8000-000000000022', 'demo-group-before', 'incoming', 'whatsapp', 'd3300004-0000-4000-8000-000000000002', 'DEMO — Grupo antes do marco', 'received', v_now - interval '90 minutes', v_now - interval '90 minutes', v_now - interval '90 minutes', v_now - interval '90 minutes'),
    ('d3400007-0000-4000-8000-000000000003', v_workspace_id, v_channel_id, 'd3300003-0000-4000-8000-000000000022', 'demo-group-after', 'incoming', 'whatsapp', 'd3300004-0000-4000-8000-000000000002', 'DEMO — Grupo após o marco', 'received', v_now - interval '30 minutes', v_now - interval '30 minutes', v_now - interval '30 minutes', v_now - interval '30 minutes')
  on conflict do nothing;

  insert into public.conversation_read_states (
    id, workspace_id, conversation_id, member_id, is_unread,
    marked_unread_at, last_read_at, created_at, updated_at
  ) values (
    'd3400009-0000-4000-8000-000000000001', v_workspace_id,
    'd3300003-0000-4000-8000-000000000017', v_attendant_member_id,
    true, v_now, v_now - interval '1 day', v_now, v_now
  ) on conflict (workspace_id, conversation_id, member_id) do update
    set is_unread = true, marked_unread_at = excluded.marked_unread_at;

  insert into public.work_tasks (
    id, workspace_id, task_type, title, status, priority, due_at,
    responsible_member_id, contact_id, created_by_member_id, created_at, updated_at
  ) values
    ('d340000a-0000-4000-8000-000000000001', v_workspace_id, 'follow_up', 'DEMO — Follow-up futuro', 'pending', 'normal', v_now + interval '1 day', v_attendant_member_id, 'd3300001-0000-4000-8000-000000000001', v_owner_member_id, v_now, v_now),
    ('d340000a-0000-4000-8000-000000000002', v_workspace_id, 'follow_up', 'DEMO — Follow-up vencido', 'pending', 'high', v_now - interval '1 hour', v_attendant_member_id, 'd3300001-0000-4000-8000-000000000003', v_owner_member_id, v_now, v_now)
  on conflict do nothing;
end $$;
