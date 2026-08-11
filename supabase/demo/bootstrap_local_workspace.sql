-- Bootstrap de Workspace e Usuário Local do ImobFlux

set search_path to public, extensions, pg_catalog;
alter role postgres set search_path to "$user", public, extensions;

do $$
declare
  v_auth_id uuid;
begin
  select id into v_auth_id from auth.users where email = 'corretor@imobflux.local' limit 1;

  if v_auth_id is null then
    v_auth_id := '11111111-1111-4000-8000-111111111111';
    insert into auth.users (id, instance_id, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, role, aud)
    values (
      v_auth_id,
      '00000000-0000-0000-0000-000000000000',
      'corretor@imobflux.local',
      extensions.crypt('Sprint22-demo-pass!', extensions.gen_salt('bf')),
      '{"provider":"email","providers":["email"]}',
      '{"display_name":"Corretor ImobFlux"}',
      now(),
      now(),
      'authenticated',
      'authenticated'
    );
  end if;

  if to_regclass('public.workspaces') is not null and not exists (select 1 from public.workspaces) then
    perform public.bootstrap_initial_workspace(
      v_auth_id,
      'Corretor ImobFlux',
      'ImobFlux Imóveis',
      'America/Maceio'
    );
  end if;
end $$;
