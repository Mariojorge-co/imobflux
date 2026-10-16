-- ImobFlux: anexos nas respostas rápidas (até 5 arquivos de até 25 MB por resposta). Tudo ADITIVO: uma tabela nova e três
-- funções novas; nada que já existe muda (get_quick_replies, save_quick_reply e o envio de mídia seguem iguais, então o app
-- anterior continua funcionando com o banco já migrado).
--
-- Os arquivos ficam no bucket privado 'whatsapp-media' (já existente, sem política para usuários: só o servidor lê e grava),
-- sob '<workspace>/quick-replies/<resposta>/<uuid>'. O banco guarda só o registro (nome, tipo, tamanho, caminho).
--
-- Permissão = a mesma da resposta: o proprietário mexe nos anexos de qualquer resposta; o atendente só nos das respostas que
-- ele criou. Todo membro ativo do workspace lê (para poder usar a resposta). Escrita só pelas funções (definer, search_path
-- vazio); a tabela não aceita INSERT/UPDATE/DELETE direto. Apagar a resposta apaga os registros (cascata); o app remove os
-- arquivos do Storage. A auditoria não guarda nome nem conteúdo do arquivo.

create table public.quick_reply_attachments (
    id uuid default gen_random_uuid() not null,
    workspace_id uuid not null,
    quick_reply_id uuid not null,
    storage_path text not null,
    file_name text not null,
    mime_type text not null,
    size_bytes bigint not null,
    media_kind text not null,
    position integer not null,
    created_by_member_id uuid not null,
    created_at timestamptz default now() not null,

    constraint pk_quick_reply_attachments primary key (id),
    constraint uq_quick_reply_attachments_path unique (storage_path),
    constraint fk_quick_reply_attachments_workspace
        foreign key (workspace_id) references public.workspaces (id) on delete restrict,
    constraint fk_quick_reply_attachments_reply
        foreign key (quick_reply_id) references public.quick_replies (id) on delete cascade,
    constraint fk_quick_reply_attachments_creator
        foreign key (workspace_id, created_by_member_id) references public.workspace_members (workspace_id, id) on delete restrict,
    constraint ck_quick_reply_attachments_size check (size_bytes > 0 and size_bytes <= 26214400),
    constraint ck_quick_reply_attachments_kind check (media_kind in ('image', 'video', 'audio', 'document')),
    constraint ck_quick_reply_attachments_name check (char_length(file_name) between 1 and 200),
    constraint ck_quick_reply_attachments_position check (position between 0 and 4)
);

create index idx_quick_reply_attachments_reply on public.quick_reply_attachments (quick_reply_id, position);
create index idx_quick_reply_attachments_workspace on public.quick_reply_attachments (workspace_id);

alter table public.quick_reply_attachments enable row level security;
revoke all on table public.quick_reply_attachments from public, anon, authenticated, service_role;
grant select on table public.quick_reply_attachments to authenticated;

create policy quick_reply_attachments_select_member on public.quick_reply_attachments
    for select to authenticated
    using (workspace_id in (select context.workspace_id from private.active_member_context() as context));

-- ─── Leitura: todos os anexos do workspace (a RLS decide), sem o caminho do arquivo ──────────────

create or replace function public.get_quick_reply_attachments()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
    select coalesce(
        pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
                'id', attachment.id,
                'quick_reply_id', attachment.quick_reply_id,
                'file_name', attachment.file_name,
                'mime_type', attachment.mime_type,
                'size_bytes', attachment.size_bytes,
                'media_kind', attachment.media_kind,
                'position', attachment.position
            ) order by attachment.quick_reply_id, attachment.position, attachment.id
        ),
        '[]'::pg_catalog.jsonb
    )
    from public.quick_reply_attachments as attachment;
$function$;

-- ─── Adicionar um anexo (o arquivo já foi enviado ao Storage pelo servidor) ──────────────────────

create or replace function public.add_quick_reply_attachment(
    p_reply_id uuid,
    p_storage_path text,
    p_file_name text,
    p_mime_type text,
    p_size_bytes bigint,
    p_media_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_context record;
    v_reply public.quick_replies;
    v_count integer;
    v_attachment public.quick_reply_attachments;
    v_now timestamptz := pg_catalog.clock_timestamp();
begin
    select context.* into v_context from private.active_member_context() as context limit 1;
    if v_context.member_id is null then
        raise exception 'quick_reply_not_authorized' using errcode = '42501';
    end if;

    -- Trava a resposta: dois anexos ao mesmo tempo não passam do limite.
    select reply.* into v_reply
    from public.quick_replies as reply
    where reply.id = p_reply_id and reply.workspace_id = v_context.workspace_id
    for update;
    if v_reply.id is null then
        raise exception 'quick_reply_not_found' using errcode = 'P0002';
    end if;
    if v_context.member_role <> 'owner' and v_reply.created_by_member_id <> v_context.member_id then
        raise exception 'quick_reply_not_authorized' using errcode = '42501';
    end if;

    if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > 26214400 then
        raise exception 'quick_reply_attachment_invalid' using errcode = '22023';
    end if;
    if p_media_kind is null or p_media_kind not in ('image', 'video', 'audio', 'document') then
        raise exception 'quick_reply_attachment_invalid' using errcode = '22023';
    end if;
    if p_file_name is null or pg_catalog.char_length(pg_catalog.btrim(p_file_name)) not between 1 and 200 then
        raise exception 'quick_reply_attachment_invalid' using errcode = '22023';
    end if;
    -- O caminho tem de ser deste workspace e desta resposta (ninguém aponta para o arquivo de outro lugar).
    if p_storage_path is null
       or p_storage_path not like (v_context.workspace_id::text || '/quick-replies/' || p_reply_id::text || '/%') then
        raise exception 'quick_reply_attachment_invalid' using errcode = '22023';
    end if;

    select pg_catalog.count(*) into v_count
    from public.quick_reply_attachments as attachment
    where attachment.quick_reply_id = p_reply_id;
    if v_count >= 5 then
        raise exception 'quick_reply_attachment_limit' using errcode = '22023';
    end if;

    insert into public.quick_reply_attachments (
        workspace_id, quick_reply_id, storage_path, file_name, mime_type, size_bytes, media_kind, position,
        created_by_member_id, created_at
    )
    values (
        v_context.workspace_id, p_reply_id, p_storage_path, pg_catalog.btrim(p_file_name),
        coalesce(nullif(pg_catalog.btrim(p_mime_type), ''), 'application/octet-stream'), p_size_bytes, p_media_kind,
        (select coalesce(pg_catalog.max(attachment.position) + 1, 0)
         from public.quick_reply_attachments as attachment where attachment.quick_reply_id = p_reply_id),
        v_context.member_id, v_now
    )
    returning * into v_attachment;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type,
        target_id, result, metadata, occurred_at, recorded_at
    )
    values (
        v_context.workspace_id, 'member', v_context.member_id, 'quick_reply.attachment_added',
        'quick_reply', p_reply_id, 'success',
        pg_catalog.jsonb_build_object('media_kind', p_media_kind, 'size_bytes', p_size_bytes), v_now, v_now
    );

    return pg_catalog.jsonb_build_object(
        'status', 'success',
        'id', v_attachment.id,
        'position', v_attachment.position
    );
end;
$function$;

-- ─── Remover um anexo; devolve o caminho para o app apagar o arquivo do Storage ──────────────────

create or replace function public.remove_quick_reply_attachment(p_attachment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_context record;
    v_attachment public.quick_reply_attachments;
    v_reply public.quick_replies;
    v_now timestamptz := pg_catalog.clock_timestamp();
begin
    select context.* into v_context from private.active_member_context() as context limit 1;
    if v_context.member_id is null then
        raise exception 'quick_reply_not_authorized' using errcode = '42501';
    end if;

    select attachment.* into v_attachment
    from public.quick_reply_attachments as attachment
    where attachment.id = p_attachment_id and attachment.workspace_id = v_context.workspace_id
    for update;
    if v_attachment.id is null then
        raise exception 'quick_reply_not_found' using errcode = 'P0002';
    end if;

    select reply.* into v_reply from public.quick_replies as reply where reply.id = v_attachment.quick_reply_id;
    if v_context.member_role <> 'owner' and v_reply.created_by_member_id <> v_context.member_id then
        raise exception 'quick_reply_not_authorized' using errcode = '42501';
    end if;

    delete from public.quick_reply_attachments where id = v_attachment.id;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type,
        target_id, result, metadata, occurred_at, recorded_at
    )
    values (
        v_context.workspace_id, 'member', v_context.member_id, 'quick_reply.attachment_removed',
        'quick_reply', v_attachment.quick_reply_id, 'success', '{}'::jsonb, v_now, v_now
    );

    return pg_catalog.jsonb_build_object('status', 'success', 'storage_path', v_attachment.storage_path);
end;
$function$;

alter function public.get_quick_reply_attachments() owner to postgres;
alter function public.add_quick_reply_attachment(uuid, text, text, text, bigint, text) owner to postgres;
alter function public.remove_quick_reply_attachment(uuid) owner to postgres;
revoke all on function public.get_quick_reply_attachments() from public, anon, service_role;
revoke all on function public.add_quick_reply_attachment(uuid, text, text, text, bigint, text) from public, anon, service_role;
revoke all on function public.remove_quick_reply_attachment(uuid) from public, anon, service_role;
grant execute on function public.get_quick_reply_attachments() to authenticated;
grant execute on function public.add_quick_reply_attachment(uuid, text, text, text, bigint, text) to authenticated;
grant execute on function public.remove_quick_reply_attachment(uuid) to authenticated;
