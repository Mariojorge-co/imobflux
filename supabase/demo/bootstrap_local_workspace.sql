-- Bootstrap de Workspace e Usuário Local do ImobFlux

set search_path to public, auth, extensions, pg_catalog;
alter role postgres set search_path to "$user", public, extensions;

do $$
declare
  v_auth_id uuid;
begin
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
end $$;
