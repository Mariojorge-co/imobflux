-- ImobFlux: correções da revisão adversarial da branch feat/mvp-noite (achados A1, B1 a B5 e M1).
--
-- Esta migration vem DEPOIS de 004300 a 004800 e não altera nenhuma delas. Só redefine funções
-- (create or replace) e permissões; não mexe em tabelas nem em dados. Rollback no fim do arquivo.
--
--   A1  prepare_team_invitation reaproveita o app_users existente (achado pelo e-mail em auth.users) ao
--       reconvidar alguém cujo vínculo foi removido. Antes, o convite criava um app_users novo que nunca
--       conseguia ser vinculado ao acesso já existente (team_auth_identity_already_linked) e o aceite
--       falhava. Pessoa ativa em outro workspace ou identidade desativada: team_identity_unavailable.
--   B1  revoke explícito de service_role nas funções novas (não depender do privilégio padrão do ambiente).

-- ─── A1: reconvidar quem foi removido ───────────────────────────────────────────────────────────
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
    v_app_user_status text;
    v_existing_name text;
    v_auth_user_id uuid;
    v_reused boolean := false;
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

    -- Identidade que já existe (ex.: convite anterior aceito e depois removido): reaproveita o app_users,
    -- senão o novo convite nunca poderia ser vinculado ao acesso existente. O nome já cadastrado é mantido.
    select auth_user.id
    into v_auth_user_id
    from auth.users as auth_user
    where pg_catalog.lower(pg_catalog.btrim(auth_user.email::text)) = v_email
    limit 1;

    if v_auth_user_id is not null then
        select app_user.id, app_user.status, app_user.display_name
        into v_app_user_id, v_app_user_status, v_existing_name
        from public.app_users as app_user
        where app_user.auth_user_id = v_auth_user_id;

        if v_app_user_id is not null then
            -- Identidade desativada, ou com vínculo vivo em outro workspace (dois contextos ativos
            -- não são suportados): não reaproveita.
            if v_app_user_status <> 'active' or exists (
                select 1 from public.workspace_members as other
                where other.user_id = v_app_user_id and other.status <> 'removed'
            ) then
                raise exception 'team_identity_unavailable' using errcode = '55000';
            end if;
            v_reused := true;
            v_display_name := coalesce(v_existing_name, v_display_name);
        end if;
    end if;

    if v_app_user_id is null then
        insert into public.app_users (display_name, status)
        values (v_display_name, 'active')
        returning id into v_app_user_id;
    end if;

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
        'success', pg_catalog.jsonb_build_object('role', 'attendant', 'identity_reused', v_reused), v_now, v_now
    );

    return pg_catalog.jsonb_build_object(
        'member_id', v_member_id,
        'email', v_email,
        'display_name', v_display_name,
        'expires_at', v_now + interval '1 hour',
        'identity_reused', v_reused
    );
end;
$function$;

-- ─── B1: revoke explícito de service_role (independe do privilégio padrão do ambiente) ───────────────
-- Todas estas funções dependem de auth.uid(); com a chave de serviço o contexto é vazio e elas recusam.
-- Mesmo assim, o acesso é fechado de forma explícita, como nas funções de equipe mais antigas.
revoke all on function public.remove_team_member(uuid) from public, anon, service_role;
revoke all on function public.assign_conversation(uuid, uuid) from public, anon, service_role;
revoke all on function public.unassign_conversation(uuid, uuid) from public, anon, service_role;
revoke all on function public.reassign_conversation(uuid, uuid, uuid) from public, anon, service_role;
revoke all on function public.prepare_team_invitation(text, text) from public, anon, service_role;
revoke all on function public.complete_work_task(uuid) from public, anon, service_role;
revoke all on function public.upsert_work_task(text, text, timestamptz, uuid, uuid, uuid, uuid) from public, anon, service_role;
revoke all on function private.is_conversation_team_visible(uuid) from public, anon, authenticated, service_role;
revoke all on function private.is_task_context_team_visible(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.member_display_name(uuid, uuid) from public, anon, service_role;

-- Funções redefinidas acima: garante dono e permissões finais
alter function public.prepare_team_invitation(text, text) owner to postgres;
alter function public.assign_conversation(uuid, uuid) owner to postgres;
alter function public.reassign_conversation(uuid, uuid, uuid) owner to postgres;
alter function public.create_work_task(text, text, timestamptz, text, uuid, text, timestamptz, uuid, uuid, uuid) owner to postgres;
alter function public.reassign_work_task(uuid, uuid) owner to postgres;
alter function public.complete_work_task(uuid) owner to postgres;
alter function public.upsert_work_task(text, text, timestamptz, uuid, uuid, uuid, uuid) owner to postgres;
alter function public.get_audit_events(text, uuid, timestamptz, timestamptz, timestamptz, uuid, integer) owner to postgres;
alter function public.export_dataset(text) owner to postgres;
grant execute on function public.prepare_team_invitation(text, text) to authenticated;
grant execute on function public.complete_work_task(uuid) to authenticated;
grant execute on function public.upsert_work_task(text, text, timestamptz, uuid, uuid, uuid, uuid) to authenticated;

-- ─── ROLLBACK (manual, só funções; nada de tabela nem de dado) ───────────────────────────────────────
-- Restaurar as definições anteriores, copiando o corpo dos arquivos indicados:
--   prepare_team_invitation        <- 20260802002700_add_team_management.sql
--   assign_conversation / reassign_conversation <- 20260802004400_conversation_assignments.sql
--   create_work_task / reassign_work_task / complete_work_task / upsert_work_task <- 20260802004600_work_tasks.sql
--   get_audit_events               <- 20260802004500_audit_trail.sql
--   export_dataset                 <- 20260802004700_export_dataset.sql
-- Os revokes de service_role podem ficar (são mais restritivos e inofensivos).
-- Convites criados com identidade reaproveitada continuam válidos: o vínculo aponta para o mesmo app_users.
