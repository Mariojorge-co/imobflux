-- ImobFlux: a protected contact prevails even inside a group released to the team.
-- Messages sent by (and participant rows of) a protected contact, or a protected
-- contact point, stay OWNER-only. Previously only the group's own visibility was
-- checked, so an ATTENDANT could read a protected contact's group messages and name.

create or replace function private.is_protected_contact_point(p_contact_point_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
    select exists (
        select 1
        from public.contact_points as point
        left join public.contacts as contact
          on contact.workspace_id = point.workspace_id
         and contact.id = point.contact_id
        where point.id = p_contact_point_id
          and (point.is_protected or coalesce(contact.is_protected, false))
    );
$function$;

alter function private.is_protected_contact_point(uuid) owner to postgres;
revoke all on function private.is_protected_contact_point(uuid) from public, anon, authenticated, service_role;
grant execute on function private.is_protected_contact_point(uuid) to authenticated;

drop policy if exists messages_select_effective_member on public.messages;
create policy messages_select_effective_member on public.messages for select to authenticated
using (
    private.is_owner_in_workspace(workspace_id)
    or (
        private.can_access_conversation_event(conversation_id, occurred_at)
        and (
            sender_contact_point_id is null
            or not private.is_protected_contact_point(sender_contact_point_id)
        )
    )
);

drop policy if exists conversation_participants_select_effective_member on public.conversation_participants;
create policy conversation_participants_select_effective_member on public.conversation_participants for select to authenticated
using (
    private.is_owner_in_workspace(workspace_id)
    or (
        private.can_access_conversation(conversation_id)
        and (
            contact_point_id is null
            or not private.is_protected_contact_point(contact_point_id)
        )
    )
);
