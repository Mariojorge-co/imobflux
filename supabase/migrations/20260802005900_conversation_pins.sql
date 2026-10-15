-- ImobFlux: fixar conversas no topo da lista. A fixação é PESSOAL (de cada usuário, não da equipe), com limite de 5 por
-- pessoa. Tabela própria com RLS por usuário; a escrita é só pela função. Só ADICIONA (tabela e função novas; nenhuma linha).

create table public.conversation_pins (
    workspace_id uuid not null,
    member_id uuid not null,
    conversation_id uuid not null,
    pinned_at timestamptz not null default now(),

    constraint pk_conversation_pins primary key (member_id, conversation_id),
    constraint fk_conversation_pins_member
        foreign key (workspace_id, member_id) references public.workspace_members (workspace_id, id) on delete restrict,
    constraint fk_conversation_pins_conversation
        foreign key (workspace_id, conversation_id) references public.conversations (workspace_id, id) on delete restrict
);
create index idx_conversation_pins_member on public.conversation_pins (workspace_id, member_id, pinned_at desc);

alter table public.conversation_pins enable row level security;
revoke all on table public.conversation_pins from public, anon, authenticated, service_role;
grant select on table public.conversation_pins to authenticated;

-- Cada pessoa lê só as próprias fixações.
create policy conversation_pins_select_own on public.conversation_pins
    for select to authenticated
    using (member_id in (select context.member_id from private.active_member_context() as context));

create or replace function public.set_conversation_pin(p_conversation_id uuid, p_pinned boolean)
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
        raise exception 'pin_not_authorized' using errcode = '42501';
    end if;
    if not exists (
        select 1 from public.conversations as conversation
        where conversation.id = p_conversation_id and conversation.workspace_id = v_context.workspace_id
    ) then
        raise exception 'conversation_not_available' using errcode = '42704';
    end if;
    if not private.can_access_conversation(p_conversation_id) then
        raise exception 'pin_not_authorized' using errcode = '42501';
    end if;

    if not coalesce(p_pinned, true) then
        delete from public.conversation_pins where member_id = v_context.member_id and conversation_id = p_conversation_id;
        return jsonb_build_object('status', 'unpinned');
    end if;

    if exists (select 1 from public.conversation_pins where member_id = v_context.member_id and conversation_id = p_conversation_id) then
        return jsonb_build_object('status', 'unchanged');
    end if;

    -- Evita corrida entre duas fixações simultâneas da mesma pessoa.
    perform pg_advisory_xact_lock(pg_catalog.hashtextextended('pins:' || v_context.member_id::text, 0));
    select count(*) into v_count from public.conversation_pins where member_id = v_context.member_id;
    if v_count >= 5 then
        raise exception 'pin_limit_reached' using errcode = '22023';
    end if;

    insert into public.conversation_pins (workspace_id, member_id, conversation_id)
    values (v_context.workspace_id, v_context.member_id, p_conversation_id);
    return jsonb_build_object('status', 'pinned', 'count', v_count + 1);
end;
$function$;

alter function public.set_conversation_pin(uuid, boolean) owner to postgres;
revoke all on function public.set_conversation_pin(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.set_conversation_pin(uuid, boolean) to authenticated;
