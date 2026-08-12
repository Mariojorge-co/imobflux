-- Bootstrap de Workspace e Usuário Local do ImobFlux

set search_path to public, auth, extensions, pg_catalog;

do $$
declare
  v_auth_id uuid;
  v_attendant_auth_id uuid := '22222222-2222-4000-8000-222222222222';
  v_workspace_id uuid;
  v_owner_member_id uuid;
  v_attendant_app_user_id uuid := '22222222-2222-4000-8000-222222222223';
  v_attendant_member_id uuid := '22222222-2222-4000-8000-222222222224';
begin
  set local search_path = auth, public, extensions, pg_catalog;
  select id into v_auth_id from auth.users where email = 'corretor@imobflux.local' limit 1;

  if v_auth_id is null then
    v_auth_id := '11111111-1111-4000-8000-111111111111';
    insert into auth.users (
      id,
      instance_id,
      email,
      encrypted_password,
      email_confirmed_at,
      confirmation_token,
      recovery_token,
      email_change_token_new,
      email_change,
      email_change_token_current,
      phone_change,
      phone_change_token,
      reauthentication_token,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      role,
      aud,
      is_sso_user,
      is_anonymous
    )
    values (
      v_auth_id,
      '00000000-0000-0000-0000-000000000000',
      'corretor@imobflux.local',
      extensions.crypt('Sprint22-demo-pass!', extensions.gen_salt('bf')),
      now(),
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Corretor ImobFlux"}'::jsonb,
      now(),
      now(),
      'authenticated',
      'authenticated',
      false,
      false
    );
  else
    update auth.users
    set
      encrypted_password = extensions.crypt('Sprint22-demo-pass!', extensions.gen_salt('bf')),
      email_confirmed_at = coalesce(email_confirmed_at, now()),
      confirmation_token = coalesce(confirmation_token, ''),
      recovery_token = coalesce(recovery_token, ''),
      email_change_token_new = coalesce(email_change_token_new, ''),
      email_change = coalesce(email_change, ''),
      email_change_token_current = coalesce(email_change_token_current, ''),
      phone_change = coalesce(phone_change, ''),
      phone_change_token = coalesce(phone_change_token, ''),
      reauthentication_token = coalesce(reauthentication_token, ''),
      raw_app_meta_data = '{"provider":"email","providers":["email"]}'::jsonb,
      raw_user_meta_data = '{"display_name":"Corretor ImobFlux"}'::jsonb,
      updated_at = now()
    where id = v_auth_id;
  end if;

  delete from auth.identities where user_id = v_auth_id or provider_id = 'corretor@imobflux.local';

  insert into auth.identities (
    id,
    user_id,
    identity_data,
    provider,
    provider_id,
    last_sign_in_at,
    created_at,
    updated_at
  )
  values (
    v_auth_id,
    v_auth_id,
    jsonb_build_object('sub', v_auth_id::text, 'email', 'corretor@imobflux.local', 'email_verified', true),
    'email',
    'corretor@imobflux.local',
    now(),
    now(),
    now()
  );

  if to_regclass('public.workspaces') is not null and not exists (select 1 from public.workspaces) then
    perform public.bootstrap_initial_workspace(
      v_auth_id,
      'Corretor ImobFlux',
      'ImobFlux Imóveis',
      'America/Maceio'
    );
  end if;

  select workspace.id, member.id
  into v_workspace_id, v_owner_member_id
  from public.workspaces as workspace
  join public.workspace_members as member
    on member.workspace_id = workspace.id
   and member.role = 'owner'
   and member.status = 'active'
  limit 1;

  if v_workspace_id is null then
    raise exception 'DEMO workspace com OWNER ativo não encontrado';
  end if;

  insert into auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token,
    reauthentication_token, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, role, aud, is_sso_user, is_anonymous
  ) values (
    v_attendant_auth_id, '00000000-0000-0000-0000-000000000000',
    'atendente@imobflux.local',
    extensions.crypt('Equipe-demo-pass!', extensions.gen_salt('bf')),
    now(), '', '', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Atendente Demo"}'::jsonb,
    now(), now(), 'authenticated', 'authenticated', false, false
  )
  on conflict (id) do update set
    email = excluded.email,
    encrypted_password = excluded.encrypted_password,
    email_confirmed_at = excluded.email_confirmed_at,
    raw_app_meta_data = excluded.raw_app_meta_data,
    raw_user_meta_data = excluded.raw_user_meta_data,
    updated_at = now();

  delete from auth.identities
  where user_id = v_attendant_auth_id or provider_id = 'atendente@imobflux.local';

  insert into auth.identities (
    id, user_id, identity_data, provider, provider_id,
    last_sign_in_at, created_at, updated_at
  ) values (
    v_attendant_auth_id, v_attendant_auth_id,
    jsonb_build_object('sub', v_attendant_auth_id::text, 'email', 'atendente@imobflux.local', 'email_verified', true),
    'email', 'atendente@imobflux.local', now(), now(), now()
  );

  insert into public.app_users (id, auth_user_id, display_name, status)
  values (v_attendant_app_user_id, v_attendant_auth_id, 'Atendente Demo', 'active')
  on conflict (id) do update set
    auth_user_id = excluded.auth_user_id,
    display_name = excluded.display_name,
    status = 'active',
    deactivated_at = null;

  insert into public.workspace_members (
    id, workspace_id, user_id, invited_email_normalized, role, status,
    invited_by_member_id, invited_at, invitation_expires_at, activated_at
  ) values (
    v_attendant_member_id, v_workspace_id, v_attendant_app_user_id,
    'atendente@imobflux.local', 'attendant', 'active', v_owner_member_id,
    now(), now() + interval '1 hour', now()
  )
  on conflict (id) do update set
    status = 'active', suspended_at = null, removed_at = null,
    user_id = excluded.user_id, workspace_id = excluded.workspace_id;
end $$;
