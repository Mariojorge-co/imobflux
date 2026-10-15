-- ImobFlux: respostas rápidas (modelos de texto da equipe) e suas categorias.
--
-- Regras:
--   * Todo membro ativo (owner e attendant) lê, cria e usa; os dados são do workspace e nunca cruzam workspaces.
--   * Edita/apaga: o OWNER qualquer item; o ATTENDANT somente o que ele mesmo criou.
--   * Apagar uma categoria NÃO apaga respostas: elas voltam para "sem categoria".
--   * Escrita só pelas funções abaixo (SECURITY DEFINER, search_path vazio); as tabelas não aceitam INSERT/UPDATE/DELETE
--     direto de usuário. A leitura direta é protegida por RLS (membro ativo do próprio workspace).
--   * Auditoria em criar/editar/apagar SEM o texto das respostas (só identificadores e quais campos mudaram).
--   * Nenhum dado é inserido pela migration; os modelos de exemplo só entram quando a pessoa pede.

-- ─── Tabelas ─────────────────────────────────────────────────────────────────────────────────────

create table public.quick_reply_categories (
    id uuid default gen_random_uuid() not null,
    workspace_id uuid not null,
    name text not null,
    created_by_member_id uuid not null,
    created_at timestamptz default now() not null,
    updated_at timestamptz default now() not null,

    constraint pk_quick_reply_categories primary key (id),
    constraint uq_quick_reply_categories_workspace_id unique (workspace_id, id),
    constraint fk_quick_reply_categories_workspace
        foreign key (workspace_id) references public.workspaces (id) on delete restrict,
    constraint fk_quick_reply_categories_creator
        foreign key (workspace_id, created_by_member_id) references public.workspace_members (workspace_id, id) on delete restrict,
    constraint ck_quick_reply_categories_name
        check (name = btrim(name) and char_length(name) between 1 and 40)
);

create unique index uq_quick_reply_categories_name
    on public.quick_reply_categories (workspace_id, lower(name));

create table public.quick_replies (
    id uuid default gen_random_uuid() not null,
    workspace_id uuid not null,
    category_id uuid,
    title text not null,
    body text not null,
    is_active boolean default true not null,
    use_count integer default 0 not null,
    last_used_at timestamptz,
    created_by_member_id uuid not null,
    created_at timestamptz default now() not null,
    updated_at timestamptz default now() not null,

    constraint pk_quick_replies primary key (id),
    constraint fk_quick_replies_workspace
        foreign key (workspace_id) references public.workspaces (id) on delete restrict,
    constraint fk_quick_replies_category
        foreign key (workspace_id, category_id) references public.quick_reply_categories (workspace_id, id) on delete restrict,
    constraint fk_quick_replies_creator
        foreign key (workspace_id, created_by_member_id) references public.workspace_members (workspace_id, id) on delete restrict,
    constraint ck_quick_replies_title
        check (title = btrim(title) and char_length(title) between 1 and 60),
    constraint ck_quick_replies_body
        check (btrim(body, E' \t\r\n') <> '' and char_length(body) <= 4000),
    constraint ck_quick_replies_use_count
        check (use_count >= 0)
);

create index idx_quick_replies_workspace on public.quick_replies (workspace_id, title);
create index idx_quick_replies_category on public.quick_replies (workspace_id, category_id);

create trigger trg_quick_reply_categories_set_updated_at
    before update on public.quick_reply_categories
    for each row execute function public.set_updated_at();
create trigger trg_quick_replies_set_updated_at
    before update on public.quick_replies
    for each row execute function public.set_updated_at();

-- ─── RLS: membro ativo lê só o próprio workspace; ninguém escreve direto ─────────────────────────

alter table public.quick_reply_categories enable row level security;
alter table public.quick_replies enable row level security;

revoke all on table public.quick_reply_categories from public, anon, authenticated, service_role;
revoke all on table public.quick_replies from public, anon, authenticated, service_role;
grant select on table public.quick_reply_categories to authenticated;
grant select on table public.quick_replies to authenticated;

create policy quick_reply_categories_select_member on public.quick_reply_categories
    for select to authenticated
    using (workspace_id in (select context.workspace_id from private.active_member_context() as context));

create policy quick_replies_select_member on public.quick_replies
    for select to authenticated
    using (workspace_id in (select context.workspace_id from private.active_member_context() as context));

-- ─── Leitura: tudo de uma vez ────────────────────────────────────────────────────────────────────

create or replace function public.get_quick_replies()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
    v_context record;
begin
    select context.* into v_context from private.active_member_context() as context limit 1;
    if v_context.member_id is null then
        raise exception 'quick_reply_not_authorized' using errcode = '42501';
    end if;

    return jsonb_build_object(
        'me', jsonb_build_object('member_id', v_context.member_id, 'role', v_context.member_role),
        'categories', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', category.id,
                'name', category.name,
                'created_by_member_id', category.created_by_member_id
            ) order by lower(category.name), category.id)
            from public.quick_reply_categories as category
            where category.workspace_id = v_context.workspace_id
        ), '[]'::jsonb),
        'replies', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', reply.id,
                'title', reply.title,
                'body', reply.body,
                'category_id', reply.category_id,
                'is_active', reply.is_active,
                'use_count', reply.use_count,
                'last_used_at', reply.last_used_at,
                'created_by_member_id', reply.created_by_member_id
            ) order by lower(reply.title), reply.id)
            from public.quick_replies as reply
            where reply.workspace_id = v_context.workspace_id
        ), '[]'::jsonb)
    );
end;
$function$;

-- ─── Categorias ──────────────────────────────────────────────────────────────────────────────────

create or replace function public.save_quick_reply_category(
    p_category_id uuid,
    p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_context record;
    v_name text := pg_catalog.btrim(coalesce(p_name, ''));
    v_category public.quick_reply_categories;
    v_now timestamptz := pg_catalog.clock_timestamp();
    v_created boolean := false;
begin
    select context.* into v_context from private.active_member_context() as context limit 1;
    if v_context.member_id is null then
        raise exception 'quick_reply_not_authorized' using errcode = '42501';
    end if;
    if pg_catalog.char_length(v_name) < 1 or pg_catalog.char_length(v_name) > 40 then
        raise exception 'quick_reply_category_name_invalid' using errcode = '22023';
    end if;

    if p_category_id is null then
        begin
            insert into public.quick_reply_categories (workspace_id, name, created_by_member_id, created_at, updated_at)
            values (v_context.workspace_id, v_name, v_context.member_id, v_now, v_now)
            returning * into v_category;
        exception when unique_violation then
            raise exception 'quick_reply_category_duplicate' using errcode = '23505';
        end;
        v_created := true;
    else
        select category.* into v_category
        from public.quick_reply_categories as category
        where category.id = p_category_id
          and category.workspace_id = v_context.workspace_id
        for update;
        if v_category.id is null then
            raise exception 'quick_reply_not_found' using errcode = 'P0002';
        end if;
        if v_context.member_role <> 'owner' and v_category.created_by_member_id <> v_context.member_id then
            raise exception 'quick_reply_not_authorized' using errcode = '42501';
        end if;
        begin
            update public.quick_reply_categories
            set name = v_name
            where id = v_category.id
            returning * into v_category;
        exception when unique_violation then
            raise exception 'quick_reply_category_duplicate' using errcode = '23505';
        end;
    end if;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type,
        target_id, result, metadata, occurred_at, recorded_at
    )
    values (
        v_context.workspace_id, 'member', v_context.member_id,
        case when v_created then 'quick_reply.category_created' else 'quick_reply.category_updated' end,
        'quick_reply_category', v_category.id, 'success', '{}'::jsonb, v_now, v_now
    );

    return jsonb_build_object('status', 'success', 'id', v_category.id, 'name', v_category.name);
end;
$function$;

create or replace function public.delete_quick_reply_category(p_category_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_context record;
    v_category public.quick_reply_categories;
    v_moved integer;
    v_now timestamptz := pg_catalog.clock_timestamp();
begin
    select context.* into v_context from private.active_member_context() as context limit 1;
    if v_context.member_id is null then
        raise exception 'quick_reply_not_authorized' using errcode = '42501';
    end if;

    select category.* into v_category
    from public.quick_reply_categories as category
    where category.id = p_category_id
      and category.workspace_id = v_context.workspace_id
    for update;
    if v_category.id is null then
        raise exception 'quick_reply_not_found' using errcode = 'P0002';
    end if;
    if v_context.member_role <> 'owner' and v_category.created_by_member_id <> v_context.member_id then
        raise exception 'quick_reply_not_authorized' using errcode = '42501';
    end if;

    -- As respostas da categoria voltam para "sem categoria"; nenhuma é apagada.
    update public.quick_replies
    set category_id = null
    where workspace_id = v_context.workspace_id
      and category_id = v_category.id;
    get diagnostics v_moved = row_count;

    delete from public.quick_reply_categories where id = v_category.id;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type,
        target_id, result, metadata, occurred_at, recorded_at
    )
    values (
        v_context.workspace_id, 'member', v_context.member_id, 'quick_reply.category_deleted',
        'quick_reply_category', v_category.id, 'success',
        pg_catalog.jsonb_build_object('replies_moved', v_moved), v_now, v_now
    );

    return jsonb_build_object('status', 'success', 'replies_moved', v_moved);
end;
$function$;

-- ─── Respostas ───────────────────────────────────────────────────────────────────────────────────

create or replace function public.save_quick_reply(
    p_reply_id uuid,
    p_title text,
    p_body text,
    p_category_id uuid,
    p_is_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_context record;
    v_title text := pg_catalog.btrim(coalesce(p_title, ''));
    v_reply public.quick_replies;
    v_previous public.quick_replies;
    v_now timestamptz := pg_catalog.clock_timestamp();
    v_changed text[] := array[]::text[];
begin
    select context.* into v_context from private.active_member_context() as context limit 1;
    if v_context.member_id is null then
        raise exception 'quick_reply_not_authorized' using errcode = '42501';
    end if;
    if pg_catalog.char_length(v_title) < 1 or pg_catalog.char_length(v_title) > 60 then
        raise exception 'quick_reply_title_invalid' using errcode = '22023';
    end if;
    -- O texto é guardado exatamente como veio (quebras de linha, emojis e marcação do WhatsApp).
    if p_body is null or pg_catalog.btrim(p_body, E' \t\r\n') = '' or pg_catalog.char_length(p_body) > 4000 then
        raise exception 'quick_reply_body_invalid' using errcode = '22023';
    end if;
    if p_category_id is not null and not exists (
        select 1 from public.quick_reply_categories as category
        where category.id = p_category_id and category.workspace_id = v_context.workspace_id
    ) then
        raise exception 'quick_reply_category_not_found' using errcode = 'P0002';
    end if;

    if p_reply_id is null then
        insert into public.quick_replies (
            workspace_id, category_id, title, body, is_active, created_by_member_id, created_at, updated_at
        )
        values (
            v_context.workspace_id, p_category_id, v_title, p_body, coalesce(p_is_active, true),
            v_context.member_id, v_now, v_now
        )
        returning * into v_reply;
    else
        select reply.* into v_previous
        from public.quick_replies as reply
        where reply.id = p_reply_id
          and reply.workspace_id = v_context.workspace_id
        for update;
        if v_previous.id is null then
            raise exception 'quick_reply_not_found' using errcode = 'P0002';
        end if;
        if v_context.member_role <> 'owner' and v_previous.created_by_member_id <> v_context.member_id then
            raise exception 'quick_reply_not_authorized' using errcode = '42501';
        end if;

        if v_previous.title <> v_title then v_changed := pg_catalog.array_append(v_changed, 'title'); end if;
        if v_previous.body <> p_body then v_changed := pg_catalog.array_append(v_changed, 'body'); end if;
        if v_previous.category_id is distinct from p_category_id then v_changed := pg_catalog.array_append(v_changed, 'category'); end if;
        if v_previous.is_active <> coalesce(p_is_active, true) then v_changed := pg_catalog.array_append(v_changed, 'is_active'); end if;

        update public.quick_replies
        set title = v_title,
            body = p_body,
            category_id = p_category_id,
            is_active = coalesce(p_is_active, true)
        where id = v_previous.id
        returning * into v_reply;
    end if;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type,
        target_id, result, metadata, occurred_at, recorded_at
    )
    values (
        v_context.workspace_id, 'member', v_context.member_id,
        case when p_reply_id is null then 'quick_reply.created' else 'quick_reply.updated' end,
        'quick_reply', v_reply.id, 'success',
        case when p_reply_id is null then '{}'::jsonb else pg_catalog.jsonb_build_object('changed', v_changed) end,
        v_now, v_now
    );

    return jsonb_build_object('status', 'success', 'id', v_reply.id);
end;
$function$;

create or replace function public.delete_quick_reply(p_reply_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_context record;
    v_reply public.quick_replies;
    v_now timestamptz := pg_catalog.clock_timestamp();
begin
    select context.* into v_context from private.active_member_context() as context limit 1;
    if v_context.member_id is null then
        raise exception 'quick_reply_not_authorized' using errcode = '42501';
    end if;

    select reply.* into v_reply
    from public.quick_replies as reply
    where reply.id = p_reply_id
      and reply.workspace_id = v_context.workspace_id
    for update;
    if v_reply.id is null then
        raise exception 'quick_reply_not_found' using errcode = 'P0002';
    end if;
    if v_context.member_role <> 'owner' and v_reply.created_by_member_id <> v_context.member_id then
        raise exception 'quick_reply_not_authorized' using errcode = '42501';
    end if;

    delete from public.quick_replies where id = v_reply.id;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type,
        target_id, result, metadata, occurred_at, recorded_at
    )
    values (
        v_context.workspace_id, 'member', v_context.member_id, 'quick_reply.deleted',
        'quick_reply', v_reply.id, 'success', '{}'::jsonb, v_now, v_now
    );

    return jsonb_build_object('status', 'success');
end;
$function$;

-- Registra um uso (contador "mais usadas"). Qualquer membro do workspace; não é auditado (alto volume, sem texto).
create or replace function public.record_quick_reply_use(p_reply_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_context record;
    v_count integer;
begin
    select context.* into v_context from private.active_member_context() as context limit 1;
    if v_context.member_id is null then
        raise exception 'quick_reply_not_authorized' using errcode = '42501';
    end if;

    update public.quick_replies
    set use_count = use_count + 1,
        last_used_at = pg_catalog.clock_timestamp()
    where id = p_reply_id
      and workspace_id = v_context.workspace_id
    returning use_count into v_count;
    if v_count is null then
        raise exception 'quick_reply_not_found' using errcode = 'P0002';
    end if;

    return jsonb_build_object('status', 'success', 'use_count', v_count);
end;
$function$;

-- Cria os 5 modelos de exemplo quando a pessoa pede (a migration não insere nada). Só vale com a lista vazia.
create or replace function public.add_example_quick_replies()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_context record;
    v_now timestamptz := pg_catalog.clock_timestamp();
    v_added integer;
begin
    select context.* into v_context from private.active_member_context() as context limit 1;
    if v_context.member_id is null then
        raise exception 'quick_reply_not_authorized' using errcode = '42501';
    end if;
    if exists (select 1 from public.quick_replies as reply where reply.workspace_id = v_context.workspace_id) then
        raise exception 'quick_reply_examples_not_empty' using errcode = '55000';
    end if;

    insert into public.quick_replies (workspace_id, title, body, created_by_member_id, created_at, updated_at)
    select v_context.workspace_id, example.title, example.body, v_context.member_id, v_now, v_now
    from (values
        ('Boas-vindas',
         E'Olá, {{nome}}! Aqui é {{meu_nome}}, da {{empresa}}. 😊\nComo posso te ajudar hoje?'),
        ('Pedir documentos',
         E'{{nome}}, para dar andamento, preciso dos seguintes documentos:\n\n• RG e CPF\n• Comprovante de renda\n• Comprovante de residência\n\nPode me enviar por aqui mesmo. Obrigado!'),
        ('Confirmar visita',
         E'Oi, {{nome}}! Confirmando a nossa visita ao imóvel *{{imovel}}* no dia {{data}} às {{hora}}. Pode confirmar presença? 🏠'),
        ('Enviar localização',
         E'{{nome}}, segue a localização do imóvel:\n{{link}}\n\nQualquer dúvida para chegar, é só me chamar. Estou à disposição!'),
        ('Follow-up de proposta',
         E'Oi, {{nome}}, tudo bem? Passando para saber o que achou da proposta que enviei. Posso esclarecer algum ponto ou ajustar algo para você? Fico no aguardo. — {{meu_nome}}, {{empresa}}')
    ) as example(title, body);
    get diagnostics v_added = row_count;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type,
        target_id, result, metadata, occurred_at, recorded_at
    )
    values (
        v_context.workspace_id, 'member', v_context.member_id, 'quick_reply.examples_added',
        'quick_reply', null, 'success', pg_catalog.jsonb_build_object('count', v_added), v_now, v_now
    );

    return jsonb_build_object('status', 'success', 'count', v_added);
end;
$function$;

-- ─── Permissões: só usuário autenticado (nunca anon nem service_role) ────────────────────────────

revoke all on function public.get_quick_replies() from public, anon, authenticated, service_role;
revoke all on function public.save_quick_reply_category(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.delete_quick_reply_category(uuid) from public, anon, authenticated, service_role;
revoke all on function public.save_quick_reply(uuid, text, text, uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.delete_quick_reply(uuid) from public, anon, authenticated, service_role;
revoke all on function public.record_quick_reply_use(uuid) from public, anon, authenticated, service_role;
revoke all on function public.add_example_quick_replies() from public, anon, authenticated, service_role;

grant execute on function public.get_quick_replies() to authenticated;
grant execute on function public.save_quick_reply_category(uuid, text) to authenticated;
grant execute on function public.delete_quick_reply_category(uuid) to authenticated;
grant execute on function public.save_quick_reply(uuid, text, text, uuid, boolean) to authenticated;
grant execute on function public.delete_quick_reply(uuid) to authenticated;
grant execute on function public.record_quick_reply_use(uuid) to authenticated;
grant execute on function public.add_example_quick_replies() to authenticated;
