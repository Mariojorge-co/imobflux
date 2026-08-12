-- Vincula notas internas à oportunidade selecionada sem ampliar escrita direta.

set search_path to public, extensions, pg_catalog;

alter table public.internal_notes
    drop constraint if exists ck_internal_notes_context;

alter table public.internal_notes
    add constraint ck_internal_notes_context
    check (
      num_nonnulls(contact_id, opportunity_id, conversation_id) = 1
      or (
        conversation_id is not null
        and opportunity_id is not null
        and contact_id is null
      )
    );

drop function if exists public.save_internal_note(uuid, text);
drop function if exists public.save_internal_note(uuid, text, uuid);

create function public.save_internal_note(
    p_conversation_id uuid,
    p_content text,
    p_opportunity_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_member_id uuid;
  v_author_name text;
  v_contact_id uuid;
  v_opportunity_contact_id uuid;
  v_note_id uuid;
  v_trimmed text;
  v_created_at timestamptz;
begin
  v_trimmed := btrim(p_content);
  if v_trimmed is null or v_trimmed = '' then
    raise exception 'Conteúdo da nota interna não pode ser vazio.';
  end if;

  select conversation.workspace_id
  into v_workspace_id
  from public.conversations as conversation
  where conversation.id = p_conversation_id;

  if v_workspace_id is null then
    raise exception 'Conversa não encontrada.';
  end if;

  select member.id, app_user.display_name
  into v_member_id, v_author_name
  from public.workspace_members as member
  join public.app_users as app_user on app_user.id = member.user_id
  join public.workspaces as workspace on workspace.id = member.workspace_id
  where member.workspace_id = v_workspace_id
    and app_user.auth_user_id = auth.uid()
    and app_user.status = 'active'
    and member.status = 'active'
    and workspace.status = 'active'
  limit 1;

  if v_member_id is null then
    raise exception 'Membro não encontrado no workspace.';
  end if;

  if p_opportunity_id is not null then
    select contact.id
    into v_contact_id
    from public.conversation_participants as participant
    join public.contact_points as contact_point
      on contact_point.workspace_id = participant.workspace_id
     and contact_point.id = participant.contact_point_id
    join public.contacts as contact
      on contact.workspace_id = contact_point.workspace_id
     and contact.id = contact_point.contact_id
    where participant.workspace_id = v_workspace_id
      and participant.conversation_id = p_conversation_id
      and participant.left_at is null
    order by participant.first_seen_at asc, participant.id asc
    limit 1;

    if v_contact_id is null then
      raise exception 'Conversa não possui contato associado.';
    end if;

    select opportunity.contact_id
    into v_opportunity_contact_id
    from public.opportunities as opportunity
    where opportunity.id = p_opportunity_id
      and opportunity.workspace_id = v_workspace_id;

    if v_opportunity_contact_id is null then
      raise exception 'Oportunidade não encontrada no workspace da conversa.';
    end if;

    if v_opportunity_contact_id <> v_contact_id then
      raise exception 'Oportunidade não pertence ao contato da conversa.';
    end if;
  end if;

  v_created_at := now();

  insert into public.internal_notes (
    workspace_id,
    author_member_id,
    content,
    conversation_id,
    opportunity_id,
    created_at,
    updated_at
  )
  values (
    v_workspace_id,
    v_member_id,
    v_trimmed,
    p_conversation_id,
    p_opportunity_id,
    v_created_at,
    v_created_at
  )
  returning id into v_note_id;

  return jsonb_build_object(
    'success', true,
    'note_id', v_note_id,
    'note', jsonb_build_object(
      'id', v_note_id,
      'content', v_trimmed,
      'created_at', v_created_at,
      'author_name', v_author_name
    )
  );
end;
$$;

revoke all on function public.save_internal_note(uuid, text, uuid)
from public, anon, service_role;

grant execute on function public.save_internal_note(uuid, text, uuid)
to authenticated;
