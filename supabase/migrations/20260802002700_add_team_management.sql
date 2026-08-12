-- ImobFlux: OWNER-managed team invitations and membership lifecycle.

drop policy if exists workspace_members_select_active_member on public.workspace_members;
create policy workspace_members_select_scoped_member
on public.workspace_members
for select
to authenticated
using (
    id in (select context.member_id from private.active_member_context() as context)
    or workspace_id in (
        select context.workspace_id
        from private.active_member_context() as context
        where context.member_role = 'owner'
    )
);

create or replace function public.get_team_members()
returns table (
    member_id uuid,
    display_name text,
    email text,
    member_role text,
    member_status text,
    invited_at timestamptz,
    activated_at timestamptz,
    created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
    v_workspace_id uuid;
begin
    select context.workspace_id
    into v_workspace_id
    from private.active_member_context() as context
    where context.member_role = 'owner';

    if v_workspace_id is null then
        raise exception 'team_management_not_authorized' using errcode = '42501';
    end if;

    return query
    select
        member.id,
        app_user.display_name,
        coalesce(auth_user.email::text, member.invited_email_normalized),
        member.role,
        member.status,
        member.invited_at,
        member.activated_at,
        member.created_at
    from public.workspace_members as member
    join public.app_users as app_user on app_user.id = member.user_id
    left join auth.users as auth_user on auth_user.id = app_user.auth_user_id
    where member.workspace_id = v_workspace_id
      and member.status <> 'removed'
    order by
        case member.role when 'owner' then 0 else 1 end,
        app_user.display_name,
        member.id;
end;
$function$;

create or replace function public.prepare_team_invitation(
    p_display_name text,
    p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_workspace_id uuid;
    v_owner_member_id uuid;
    v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
    v_display_name text := pg_catalog.btrim(p_display_name);
    v_existing_status text;
    v_app_user_id uuid;
    v_member_id uuid;
    v_now timestamptz := pg_catalog.statement_timestamp();
begin
    select context.workspace_id, context.member_id
    into v_workspace_id, v_owner_member_id
    from private.active_member_context() as context
    where context.member_role = 'owner';

    if v_workspace_id is null then
        raise exception 'team_management_not_authorized' using errcode = '42501';
    end if;

    if v_display_name is null or v_display_name = '' then
        raise exception 'team_member_name_required' using errcode = '22023';
    end if;

    if v_email is null
       or v_email = ''
       or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
        raise exception 'team_member_email_invalid' using errcode = '22023';
    end if;

    select member.status
    into v_existing_status
    from public.workspace_members as member
    join public.app_users as app_user on app_user.id = member.user_id
    left join auth.users as auth_user on auth_user.id = app_user.auth_user_id
    where member.workspace_id = v_workspace_id
      and member.status <> 'removed'
      and (
          member.invited_email_normalized = v_email
          or pg_catalog.lower(auth_user.email::text) = v_email
      )
    order by member.created_at desc
    limit 1;

    if v_existing_status = 'active' then
        raise exception 'team_member_already_active' using errcode = '23505';
    elsif v_existing_status = 'invited' then
        raise exception 'team_invitation_already_pending' using errcode = '23505';
    elsif v_existing_status = 'suspended' then
        raise exception 'team_member_inactive' using errcode = '55000';
    end if;

    insert into public.app_users (display_name, status)
    values (v_display_name, 'active')
    returning id into v_app_user_id;

    insert into public.workspace_members (
        workspace_id,
        user_id,
        invited_email_normalized,
        role,
        status,
        invited_by_member_id,
        invited_at,
        invitation_expires_at
    )
    values (
        v_workspace_id,
        v_app_user_id,
        v_email,
        'attendant',
        'invited',
        v_owner_member_id,
        v_now,
        v_now + interval '1 hour'
    )
    returning id into v_member_id;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type,
        target_id, result, metadata, occurred_at, recorded_at
    )
    values (
        v_workspace_id, 'member', v_owner_member_id,
        'team.invitation_created', 'workspace_member', v_member_id,
        'success', pg_catalog.jsonb_build_object('role', 'attendant'), v_now, v_now
    );

    return pg_catalog.jsonb_build_object(
        'member_id', v_member_id,
        'email', v_email,
        'display_name', v_display_name,
        'expires_at', v_now + interval '1 hour'
    );
end;
$function$;

create or replace function public.get_pending_team_invitation(p_member_id uuid)
returns table (
    member_id uuid,
    display_name text,
    email text,
    auth_user_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
    v_workspace_id uuid;
begin
    select context.workspace_id
    into v_workspace_id
    from private.active_member_context() as context
    where context.member_role = 'owner';

    if v_workspace_id is null then
        raise exception 'team_management_not_authorized' using errcode = '42501';
    end if;

    return query
    select member.id, app_user.display_name, member.invited_email_normalized,
           app_user.auth_user_id
    from public.workspace_members as member
    join public.app_users as app_user on app_user.id = member.user_id
    where member.workspace_id = v_workspace_id
      and member.id = p_member_id
      and member.role = 'attendant'
      and member.status = 'invited';
end;
$function$;

create or replace function public.bind_team_invitation_auth_identity(
    p_member_id uuid,
    p_auth_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_app_user_id uuid;
    v_invited_email text;
    v_auth_email text;
begin
    if (select auth.role()) <> 'service_role' then
        raise exception 'team_invitation_binding_not_authorized' using errcode = '42501';
    end if;

    select member.user_id, member.invited_email_normalized
    into v_app_user_id, v_invited_email
    from public.workspace_members as member
    where member.id = p_member_id
      and member.role = 'attendant'
      and member.status = 'invited'
    for update;

    select pg_catalog.lower(pg_catalog.btrim(auth_user.email::text))
    into v_auth_email
    from auth.users as auth_user
    where auth_user.id = p_auth_user_id;

    if v_app_user_id is null or v_auth_email is null or v_auth_email <> v_invited_email then
        raise exception 'team_invitation_identity_mismatch' using errcode = '42501';
    end if;

    if exists (
        select 1 from public.app_users
        where auth_user_id = p_auth_user_id and id <> v_app_user_id
    ) then
        raise exception 'team_auth_identity_already_linked' using errcode = '23505';
    end if;

    update public.app_users
    set auth_user_id = p_auth_user_id
    where id = v_app_user_id
      and (auth_user_id is null or auth_user_id = p_auth_user_id);

    if not found then
        raise exception 'team_invitation_identity_mismatch' using errcode = '42501';
    end if;
end;
$function$;

create or replace function public.mark_team_invitation_resent(p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_workspace_id uuid;
    v_owner_member_id uuid;
    v_now timestamptz := pg_catalog.statement_timestamp();
begin
    select context.workspace_id, context.member_id
    into v_workspace_id, v_owner_member_id
    from private.active_member_context() as context
    where context.member_role = 'owner';

    if v_workspace_id is null then
        raise exception 'team_management_not_authorized' using errcode = '42501';
    end if;

    update public.workspace_members
    set invited_at = v_now,
        invitation_expires_at = v_now + interval '1 hour'
    where id = p_member_id
      and workspace_id = v_workspace_id
      and role = 'attendant'
      and status = 'invited';

    if not found then
        raise exception 'team_invitation_not_pending' using errcode = '55000';
    end if;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type,
        target_id, result, metadata, occurred_at, recorded_at
    ) values (
        v_workspace_id, 'member', v_owner_member_id,
        'team.invitation_resent', 'workspace_member', p_member_id,
        'success', '{}'::jsonb, v_now, v_now
    );

    return pg_catalog.jsonb_build_object('success', true, 'expires_at', v_now + interval '1 hour');
end;
$function$;

create or replace function public.accept_team_invitation()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_auth_user_id uuid := (select auth.uid());
    v_auth_email text;
    v_member public.workspace_members%rowtype;
    v_now timestamptz := pg_catalog.statement_timestamp();
begin
    select pg_catalog.lower(pg_catalog.btrim(auth_user.email::text))
    into v_auth_email
    from auth.users as auth_user
    where auth_user.id = v_auth_user_id;

    select member.*
    into v_member
    from public.workspace_members as member
    join public.app_users as app_user on app_user.id = member.user_id
    where app_user.auth_user_id = v_auth_user_id
      and member.invited_email_normalized = v_auth_email
      and member.role = 'attendant'
      and member.status = 'invited'
    for update of member;

    if v_member.id is null then
        raise exception 'team_invitation_invalid_or_used' using errcode = '42501';
    end if;

    if v_member.invitation_expires_at is null or v_member.invitation_expires_at <= v_now then
        raise exception 'team_invitation_expired' using errcode = '22023';
    end if;

    update public.workspace_members
    set status = 'active', activated_at = v_now
    where id = v_member.id;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type,
        target_id, result, metadata, occurred_at, recorded_at
    ) values (
        v_member.workspace_id, 'member', v_member.id,
        'team.invitation_accepted', 'workspace_member', v_member.id,
        'success', '{}'::jsonb, v_now, v_now
    );

    return pg_catalog.jsonb_build_object('success', true, 'member_id', v_member.id);
end;
$function$;

create or replace function public.deactivate_team_member(p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_workspace_id uuid;
    v_owner_member_id uuid;
    v_now timestamptz := pg_catalog.statement_timestamp();
begin
    select context.workspace_id, context.member_id
    into v_workspace_id, v_owner_member_id
    from private.active_member_context() as context
    where context.member_role = 'owner';

    if v_workspace_id is null then
        raise exception 'team_management_not_authorized' using errcode = '42501';
    end if;

    update public.workspace_members
    set status = 'suspended', suspended_at = v_now
    where id = p_member_id
      and workspace_id = v_workspace_id
      and role = 'attendant'
      and status = 'active';

    if not found then
        raise exception 'team_member_not_deactivatable' using errcode = '55000';
    end if;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type,
        target_id, result, metadata, occurred_at, recorded_at
    ) values (
        v_workspace_id, 'member', v_owner_member_id,
        'team.member_deactivated', 'workspace_member', p_member_id,
        'success', '{}'::jsonb, v_now, v_now
    );

    return pg_catalog.jsonb_build_object('success', true, 'status', 'suspended');
end;
$function$;

create or replace function public.reactivate_team_member(p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_workspace_id uuid;
    v_owner_member_id uuid;
    v_now timestamptz := pg_catalog.statement_timestamp();
begin
    select context.workspace_id, context.member_id
    into v_workspace_id, v_owner_member_id
    from private.active_member_context() as context
    where context.member_role = 'owner';

    if v_workspace_id is null then
        raise exception 'team_management_not_authorized' using errcode = '42501';
    end if;

    update public.workspace_members
    set status = 'active', suspended_at = null
    where id = p_member_id
      and workspace_id = v_workspace_id
      and role = 'attendant'
      and status = 'suspended';

    if not found then
        raise exception 'team_member_not_reactivatable' using errcode = '55000';
    end if;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type,
        target_id, result, metadata, occurred_at, recorded_at
    ) values (
        v_workspace_id, 'member', v_owner_member_id,
        'team.member_reactivated', 'workspace_member', p_member_id,
        'success', '{}'::jsonb, v_now, v_now
    );

    return pg_catalog.jsonb_build_object('success', true, 'status', 'active');
end;
$function$;

alter function public.get_team_members() owner to postgres;
alter function public.prepare_team_invitation(text, text) owner to postgres;
alter function public.get_pending_team_invitation(uuid) owner to postgres;
alter function public.bind_team_invitation_auth_identity(uuid, uuid) owner to postgres;
alter function public.mark_team_invitation_resent(uuid) owner to postgres;
alter function public.accept_team_invitation() owner to postgres;
alter function public.deactivate_team_member(uuid) owner to postgres;
alter function public.reactivate_team_member(uuid) owner to postgres;

revoke all on function public.get_team_members() from public, anon, service_role;
revoke all on function public.prepare_team_invitation(text, text) from public, anon, service_role;
revoke all on function public.get_pending_team_invitation(uuid) from public, anon, service_role;
revoke all on function public.bind_team_invitation_auth_identity(uuid, uuid) from public, anon, authenticated;
revoke all on function public.mark_team_invitation_resent(uuid) from public, anon, service_role;
revoke all on function public.accept_team_invitation() from public, anon, service_role;
revoke all on function public.deactivate_team_member(uuid) from public, anon, service_role;
revoke all on function public.reactivate_team_member(uuid) from public, anon, service_role;

grant execute on function public.get_team_members() to authenticated;
grant execute on function public.prepare_team_invitation(text, text) to authenticated;
grant execute on function public.get_pending_team_invitation(uuid) to authenticated;
grant execute on function public.bind_team_invitation_auth_identity(uuid, uuid) to service_role;
grant execute on function public.mark_team_invitation_resent(uuid) to authenticated;
grant execute on function public.accept_team_invitation() to authenticated;
grant execute on function public.deactivate_team_member(uuid) to authenticated;
grant execute on function public.reactivate_team_member(uuid) to authenticated;
