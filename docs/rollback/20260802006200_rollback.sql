-- ROLLBACK da migration 20260802006200_reaction_echo_dedupe.sql (manual; NÃO é uma migration).
--
-- Devolve public.ingest_whatsapp_reaction à definição da migration 20260802005800 (sem a detecção do eco das reações
-- enviadas pelo ImobFlux). Nenhum dado é tocado. Sem o ajuste, uma reação enviada pelo ImobFlux aparece duas vezes
-- (a do membro e "Celular da conta").
-- Se a migration for considerada revertida: supabase migration repair --status reverted 20260802006200
-- Como usar (produção, só com autorização): begin; \i este-arquivo.sql; -- conferir; commit;

begin;

create or replace function public.ingest_whatsapp_reaction(
    p_external_account_id text,
    p_target_external_id text,
    p_reactor_jid text,
    p_from_me boolean,
    p_emoji text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_message public.messages;
    v_phone text;
    v_point_id uuid;
    v_emoji text := pg_catalog.btrim(coalesce(p_emoji, ''));
begin
    if pg_catalog.char_length(v_emoji) > 16 then
        return jsonb_build_object('status', 'ignored', 'reason', 'invalid_emoji');
    end if;
    v_message := private.find_message_by_external(p_external_account_id, p_target_external_id);
    if v_message.id is null then
        return jsonb_build_object('status', 'ignored', 'reason', 'unknown_message');
    end if;
    if v_message.deleted_at is not null then
        return jsonb_build_object('status', 'ignored', 'reason', 'deleted');
    end if;

    if p_from_me then
        -- Reação feita pelo próprio aparelho/conta (não por um membro do CRM).
        if v_emoji = '' then
            delete from public.message_reactions where message_id = v_message.id and is_account;
            return jsonb_build_object('status', 'removed');
        end if;
        insert into public.message_reactions (workspace_id, message_id, is_account, emoji)
        values (v_message.workspace_id, v_message.id, true, v_emoji)
        on conflict (message_id) where is_account do update set emoji = excluded.emoji;
        return jsonb_build_object('status', 'success');
    end if;

    v_phone := public.normalize_brazilian_phone(pg_catalog.split_part(coalesce(p_reactor_jid, ''), '@', 1));
    select point.id into v_point_id
    from public.contact_points as point
    where point.workspace_id = v_message.workspace_id
      and point.point_type = 'phone'
      and point.normalized_value = v_phone
    limit 1;
    if v_point_id is null then
        return jsonb_build_object('status', 'ignored', 'reason', 'unknown_reactor');
    end if;

    if v_emoji = '' then
        delete from public.message_reactions where message_id = v_message.id and contact_point_id = v_point_id;
        return jsonb_build_object('status', 'removed');
    end if;
    insert into public.message_reactions (workspace_id, message_id, contact_point_id, emoji)
    values (v_message.workspace_id, v_message.id, v_point_id, v_emoji)
    on conflict (message_id, contact_point_id) where contact_point_id is not null do update set emoji = excluded.emoji;
    return jsonb_build_object('status', 'success');
end;
$function$;

commit;
