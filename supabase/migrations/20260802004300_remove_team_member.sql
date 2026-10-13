-- ImobFlux: remoção de funcionário (FLUXOS_NEGOCIO.md, fluxo 23).
--
-- Só o OWNER remove um ATTENDANT (ativo, suspenso ou convite pendente, que equivale a cancelar o
-- convite). O acesso cai na hora: private.active_member_context() só considera vínculos 'active'.
-- O trabalho dele fica livre para reatribuição, sem transferir nada para outra pessoa:
--   * atribuições de conversa em aberto são encerradas (motivo 'member_removed');
--   * oportunidades abertas/em retrabalho ficam sem responsável (as já encerradas mantêm o histórico);
--   * tarefas pendentes ficam sem responsável (continuam pendentes e com o autor original).
-- Nada é apagado: mensagens, notas, tarefas, oportunidades, cadastro e auditoria permanecem.
-- O vínculo removido nunca é reativado nem reaproveitado; voltar exige um novo convite.

create or replace function public.remove_team_member(p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_workspace_id uuid;
    v_owner_member_id uuid;
    v_target public.workspace_members%rowtype;
    v_now timestamptz := pg_catalog.statement_timestamp();
    v_ended_assignments integer := 0;
    v_cleared_opportunities integer := 0;
    v_cleared_tasks integer := 0;
begin
    select context.workspace_id, context.member_id
    into v_workspace_id, v_owner_member_id
    from private.active_member_context() as context
    where context.member_role = 'owner';

    if v_workspace_id is null then
        raise exception 'team_management_not_authorized' using errcode = '42501';
    end if;

    select member.*
    into v_target
    from public.workspace_members as member
    where member.id = p_member_id
      and member.workspace_id = v_workspace_id
      and member.role = 'attendant'
      and member.status in ('invited', 'active', 'suspended')
    for update;

    if not found then
        raise exception 'team_member_not_removable' using errcode = '55000';
    end if;

    update public.workspace_members
    set status = 'removed',
        removed_at = greatest(
            v_now,
            created_at,
            coalesce(suspended_at, activated_at, invited_at, created_at)
        )
    where id = v_target.id;

    update public.conversation_assignments
    set ended_at = greatest(v_now, assigned_at),
        ended_by_member_id = v_owner_member_id,
        end_reason = 'member_removed'
    where workspace_id = v_workspace_id
      and member_id = v_target.id
      and ended_at is null;
    get diagnostics v_ended_assignments = row_count;

    with cleared as (
        update public.opportunities
        set responsible_member_id = null
        where workspace_id = v_workspace_id
          and responsible_member_id = v_target.id
          and status in ('open', 'rework')
          and archived_at is null
        returning id
    ), logged as (
        insert into public.audit_events (
            workspace_id, actor_type, actor_member_id, action, target_type,
            target_id, result, metadata, occurred_at, recorded_at
        )
        select
            v_workspace_id, 'member', v_owner_member_id,
            'opportunity.responsible_cleared', 'opportunity', cleared.id,
            'success',
            pg_catalog.jsonb_build_object('previous_member_id', v_target.id, 'reason', 'member_removed'),
            v_now, v_now
        from cleared
        returning 1
    )
    select count(*) into v_cleared_opportunities from cleared;

    update public.work_tasks
    set responsible_member_id = null
    where workspace_id = v_workspace_id
      and responsible_member_id = v_target.id
      and status = 'pending';
    get diagnostics v_cleared_tasks = row_count;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type,
        target_id, result, metadata, occurred_at, recorded_at
    ) values (
        v_workspace_id, 'member', v_owner_member_id,
        'team.member_removed', 'workspace_member', v_target.id,
        'success',
        pg_catalog.jsonb_build_object(
            'previous_status', v_target.status,
            'ended_conversation_assignments', v_ended_assignments,
            'cleared_opportunities', v_cleared_opportunities,
            'cleared_tasks', v_cleared_tasks
        ),
        v_now, v_now
    );

    return pg_catalog.jsonb_build_object(
        'success', true,
        'status', 'removed',
        'ended_conversation_assignments', v_ended_assignments,
        'cleared_opportunities', v_cleared_opportunities,
        'cleared_tasks', v_cleared_tasks
    );
end;
$function$;

alter function public.remove_team_member(uuid) owner to postgres;
revoke all on function public.remove_team_member(uuid) from public, anon, authenticated;
grant execute on function public.remove_team_member(uuid) to authenticated;
