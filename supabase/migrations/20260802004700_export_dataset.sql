-- ImobFlux: exportação de dados (FLUXOS_NEGOCIO.md, fluxo 26).
--
-- Somente o OWNER exporta. A função devolve as linhas já prontas para virar CSV e registra a
-- exportação na auditoria (quem, o quê, quantas linhas; nunca nomes, telefones ou valores).
-- Tentativa de um ATTENDANT é negada e TAMBÉM auditada ("tentativa negada relevante"): por isso a
-- função devolve success=false em vez de levantar erro (um erro desfaria o registro do evento).
--
-- Conteúdo (decisões conservadoras):
--   * contacts: identificação, classificação, situação, protegido (sim/não), telefones, datas e
--     arquivamento. Contatos protegidos entram (o OWNER os administra), marcados como protegidos;
--     arquivados também entram, com a data de arquivamento (nada é excluído).
--   * opportunities: título, contato, etapa, situação, responsável, origem, tipo de operação, imóvel,
--     cidade/região, faixa de valor, prazo e datas. NÃO inclui renda familiar, valor aprovado, notas
--     financeiras, descrição nem comissões.
--   * Mensagens, notas internas e anexos não são exportados nesta versão.
--   * Limite de 20.000 linhas por exportação (truncated=true avisa quando houver mais).

create or replace function public.export_dataset(p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_context record;
    v_rows jsonb;
    v_count integer;
    v_limit constant integer := 20000;
    v_now timestamptz := pg_catalog.statement_timestamp();
begin
    if p_kind is null or p_kind not in ('contacts', 'opportunities') then
        raise exception 'invalid_export_kind' using errcode = '22023';
    end if;

    select * into v_context from private.active_member_context() limit 1;
    if v_context.member_id is null then
        raise exception 'resource_not_available' using errcode = '42501';
    end if;

    if v_context.member_role <> 'owner' then
        insert into public.audit_events (
            workspace_id, actor_type, actor_member_id, action, target_type,
            target_id, result, metadata, occurred_at, recorded_at
        ) values (
            v_context.workspace_id, 'member', v_context.member_id, 'export.' || p_kind, 'workspace',
            v_context.workspace_id, 'denied', '{}'::jsonb, v_now, v_now
        );
        return pg_catalog.jsonb_build_object('success', false, 'error', 'forbidden');
    end if;

    if p_kind = 'contacts' then
        select
            coalesce(pg_catalog.jsonb_agg(row_data order by row_created_at, row_id), '[]'::jsonb),
            count(*)::integer
        into v_rows, v_count
        from (
            select
                contact.id as row_id,
                contact.created_at as row_created_at,
                pg_catalog.jsonb_build_object(
                    'id', contact.id,
                    'display_name', contact.display_name,
                    'classification', contact.classification,
                    'operational_status', contact.operational_status,
                    'registration_status', contact.registration_status,
                    'is_protected', contact.is_protected,
                    'phones', (
                        select string_agg(point.display_value, ' | ' order by point.created_at, point.id)
                        from public.contact_points as point
                        where point.workspace_id = contact.workspace_id
                          and point.contact_id = contact.id
                          and point.point_type = 'phone'
                    ),
                    'created_at', contact.created_at,
                    'updated_at', contact.updated_at,
                    'archived_at', contact.archived_at
                ) as row_data
            from public.contacts as contact
            where contact.workspace_id = v_context.workspace_id
            order by contact.created_at, contact.id
            limit v_limit + 1
        ) as limited;
    else
        select
            coalesce(pg_catalog.jsonb_agg(row_data order by row_created_at, row_id), '[]'::jsonb),
            count(*)::integer
        into v_rows, v_count
        from (
            select
                opportunity.id as row_id,
                opportunity.created_at as row_created_at,
                pg_catalog.jsonb_build_object(
                    'id', opportunity.id,
                    'title', opportunity.title,
                    'contact_name', contact.display_name,
                    'stage_name', stage.name,
                    'status', opportunity.status,
                    'responsible_name', responsible_user.display_name,
                    'origin', opportunity.origin,
                    'operation_type', opportunity.operation_type,
                    'property_type_preference', opportunity.property_type_preference,
                    'city_region_preference', opportunity.city_region_preference,
                    'value_range_preference', opportunity.value_range_preference,
                    'timeframe_intent', opportunity.timeframe_intent,
                    'created_at', opportunity.created_at,
                    'updated_at', opportunity.updated_at,
                    'closed_at', opportunity.closed_at,
                    'archived_at', opportunity.archived_at
                ) as row_data
            from public.opportunities as opportunity
            join public.contacts as contact
              on contact.workspace_id = opportunity.workspace_id and contact.id = opportunity.contact_id
            left join public.pipeline_stages as stage
              on stage.workspace_id = opportunity.workspace_id and stage.id = opportunity.current_stage_id
            left join public.workspace_members as responsible_member
              on responsible_member.workspace_id = opportunity.workspace_id and responsible_member.id = opportunity.responsible_member_id
            left join public.app_users as responsible_user
              on responsible_user.id = responsible_member.user_id
            where opportunity.workspace_id = v_context.workspace_id
            order by opportunity.created_at, opportunity.id
            limit v_limit + 1
        ) as limited;
    end if;

    -- A linha extra só serve para detectar excesso: é descartada.
    if v_count > v_limit then
        v_rows := (select pg_catalog.jsonb_agg(item) from (
            select item from pg_catalog.jsonb_array_elements(v_rows) with ordinality as t(item, position)
            order by position limit v_limit
        ) as trimmed);
    end if;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type,
        target_id, result, metadata, occurred_at, recorded_at
    ) values (
        v_context.workspace_id, 'member', v_context.member_id, 'export.' || p_kind, 'workspace',
        v_context.workspace_id, 'success',
        pg_catalog.jsonb_build_object('row_count', least(v_count, v_limit), 'truncated', v_count > v_limit),
        v_now, v_now
    );

    return pg_catalog.jsonb_build_object(
        'success', true,
        'kind', p_kind,
        'rows', v_rows,
        'truncated', v_count > v_limit,
        'generated_at', v_now
    );
end;
$function$;

alter function public.export_dataset(text) owner to postgres;
revoke all on function public.export_dataset(text) from public, anon, service_role;
grant execute on function public.export_dataset(text) to authenticated;
