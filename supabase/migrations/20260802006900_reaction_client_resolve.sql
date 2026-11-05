-- ImobFlux: reação de CLIENTE passa a achar o contato certo (nono dígito e @lid).
--
-- Problema (visto em produção, 10 de 10 reações de cliente): `ingest_whatsapp_reaction` comparava o telefone do reator por
-- IGUALDADE EXATA com `contact_points.normalized_value`. O JID da conversa chega com 12 dígitos (sem o nono dígito) e o
-- contato está cadastrado com 13: nunca casava e a reação era descartada como `unknown_reactor`. Com identificador `@lid`
-- sem telefone útil o resultado era o mesmo.
--
-- Correção (só ADITIVA e retrocompatível: CREATE OR REPLACE da mesma função, mesma assinatura, mesmas permissões e mesmos
-- campos de resposta; o app anterior continua funcionando com o banco já migrado). Para a reação que NÃO é da nossa conta:
--   (a) conversa individual: o reator só pode ser o contato daquela conversa (o participante da própria conversa da mensagem
--       reagida). Isso resolve também o `@lid` sem telefone;
--   (b) senão (grupo ou conversa sem participante), pelo telefone, com e sem o nono dígito (`private.phone_match_candidates`),
--       escolhendo o contato mais antigo se houver mais de um;
--   (c) só então `unknown_reactor`.
-- Mantidos como estavam: reação da nossa conta (celular/eco), remoção por texto vazio, uma reação por contato e por mensagem,
-- mensagem apagada ignorada. Reação em grupo continua ignorada pelo webhook (e, no banco, só casa por telefone).

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
    v_conversation_type text;
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
        -- Reação da nossa conta (celular, ou o eco do que o ImobFlux enviou): é a MESMA pessoa dos membros do CRM.
        if v_emoji = '' then
            delete from public.message_reactions where message_id = v_message.id and (is_account or member_id is not null);
            return jsonb_build_object('status', 'removed');
        end if;
        -- Já existe a nossa reação com esse emoji (do membro): é o eco ou repetição; mantém quem reagiu.
        if exists (
            select 1 from public.message_reactions as reaction
            where reaction.message_id = v_message.id
              and (reaction.member_id is not null or reaction.is_account)
              and reaction.emoji = v_emoji
        ) then
            return jsonb_build_object('status', 'ignored', 'reason', 'echo');
        end if;
        -- Emoji diferente (ou primeira reação): o celular substitui a nossa reação anterior.
        delete from public.message_reactions where message_id = v_message.id and member_id is not null;
        insert into public.message_reactions (workspace_id, message_id, is_account, emoji)
        values (v_message.workspace_id, v_message.id, true, v_emoji)
        on conflict (message_id) where is_account do update set emoji = excluded.emoji, updated_at = pg_catalog.clock_timestamp();
        return jsonb_build_object('status', 'success');
    end if;

    -- Reação de um CLIENTE.
    select conversation.conversation_type into v_conversation_type
    from public.conversations as conversation
    where conversation.workspace_id = v_message.workspace_id and conversation.id = v_message.conversation_id;

    -- (a) Conversa individual: o reator é o contato da própria conversa (vale também para @lid sem telefone).
    if v_conversation_type = 'individual' then
        select participant.contact_point_id into v_point_id
        from public.conversation_participants as participant
        where participant.workspace_id = v_message.workspace_id
          and participant.conversation_id = v_message.conversation_id
          and participant.left_at is null
        order by participant.first_seen_at, participant.id
        limit 1;
    end if;

    -- (b) Pelo telefone, com e sem o nono dígito; se houver mais de um contato, o mais antigo.
    if v_point_id is null then
        v_phone := public.normalize_brazilian_phone(pg_catalog.split_part(coalesce(p_reactor_jid, ''), '@', 1));
        if v_phone is not null then
            select point.id into v_point_id
            from public.contact_points as point
            where point.workspace_id = v_message.workspace_id
              and point.point_type = 'phone'
              and point.normalized_value = any (private.phone_match_candidates(v_phone))
            order by point.created_at, point.id
            limit 1;
        end if;
    end if;

    -- (c) Ninguém reconhecido.
    if v_point_id is null then
        return jsonb_build_object('status', 'ignored', 'reason', 'unknown_reactor');
    end if;

    if v_emoji = '' then
        delete from public.message_reactions where message_id = v_message.id and contact_point_id = v_point_id;
        return jsonb_build_object('status', 'removed');
    end if;
    insert into public.message_reactions (workspace_id, message_id, contact_point_id, emoji)
    values (v_message.workspace_id, v_message.id, v_point_id, v_emoji)
    on conflict (message_id, contact_point_id) where contact_point_id is not null
    do update set emoji = excluded.emoji, updated_at = pg_catalog.clock_timestamp();
    return jsonb_build_object('status', 'success');
end;
$function$;
