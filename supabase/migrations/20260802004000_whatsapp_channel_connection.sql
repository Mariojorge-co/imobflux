-- ImobFlux: WhatsApp connection (QR code) lifecycle.
--
-- A workspace has at most one active WhatsApp connection (MVP). The OWNER connects it from
-- Settings: the app creates the Evolution instance, shows the QR code and, once WhatsApp
-- confirms the pairing, marks the connection 'active' with the connected number. Messages are
-- only ingested for an active connection, so this is what turns the integration on.
--
--   configured    registered, waiting for the QR code to be scanned (no number yet)
--   active        paired; messages are ingested
--   disconnected  logged out (by the OWNER, from the phone, or reported by the provider)
--   replaced      superseded by a newer active connection

-- Applies a provider state ('open' | 'close') to a connection and audits real transitions.
-- Internal: only the SECURITY DEFINER entry points below call it.
create or replace function private.apply_whatsapp_channel_state(
    p_connection_id uuid,
    p_state text,
    p_phone text,
    p_actor_member_id uuid
)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
    v_connection public.channel_connections%rowtype;
    v_now timestamptz := now();
    v_phone text := nullif(btrim(p_phone), '');
    v_changed boolean := false;
    v_action text;
begin
    if p_state not in ('open', 'close') then
        raise exception 'invalid_whatsapp_channel_state' using errcode = '22023';
    end if;
    if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$' then
        raise exception 'invalid_whatsapp_phone' using errcode = '22023';
    end if;

    select * into v_connection
    from public.channel_connections as connection
    where connection.id = p_connection_id
    for update;

    if not found then
        raise exception 'whatsapp_channel_not_found' using errcode = 'P0002';
    end if;

    if p_state = 'open' then
        v_phone := coalesce(v_phone, v_connection.external_phone_normalized);
        if v_phone is null then
            return jsonb_build_object('status', 'ignored', 'reason', 'phone_required', 'connection_status', v_connection.status);
        end if;

        if v_connection.status = 'active' then
            if v_connection.external_phone_normalized is distinct from v_phone then
                update public.channel_connections
                set external_phone_normalized = v_phone
                where id = v_connection.id;
                v_changed := true;
                v_action := 'whatsapp.channel_number_changed';
            end if;
        else
            -- One active connection per workspace: a newer pairing replaces the older one.
            update public.channel_connections
            set status = 'replaced',
                paused_at = null,
                disconnected_at = greatest(v_now, created_at)
            where workspace_id = v_connection.workspace_id
              and provider = v_connection.provider
              and status in ('active', 'paused')
              and id <> v_connection.id;

            update public.channel_connections
            set status = 'active',
                external_phone_normalized = v_phone,
                activated_at = greatest(v_now, created_at),
                paused_at = null,
                disconnected_at = null
            where id = v_connection.id;
            v_changed := true;
            v_action := 'whatsapp.channel_connected';
        end if;
    elsif v_connection.status in ('active', 'paused') then
        update public.channel_connections
        set status = 'disconnected',
            paused_at = null,
            disconnected_at = greatest(v_now, created_at)
        where id = v_connection.id;
        v_changed := true;
        v_action := 'whatsapp.channel_disconnected';
    end if;

    if v_changed then
        insert into public.audit_events (
            workspace_id, actor_type, actor_member_id, action, target_type,
            target_id, result, metadata, occurred_at, recorded_at
        )
        values (
            v_connection.workspace_id,
            case when p_actor_member_id is null then 'system' else 'member' end,
            p_actor_member_id,
            v_action,
            'channel_connection',
            v_connection.id,
            'success',
            jsonb_build_object('provider', v_connection.provider),
            v_now,
            v_now
        );
    end if;

    return jsonb_build_object(
        'status', 'success',
        'changed', v_changed,
        'connection_status', (select connection.status from public.channel_connections as connection where connection.id = v_connection.id)
    );
end;
$function$;

alter function private.apply_whatsapp_channel_state(uuid, text, text, uuid) owner to postgres;
revoke all on function private.apply_whatsapp_channel_state(uuid, text, text, uuid)
from public, anon, authenticated, service_role;

-- OWNER: registers (or re-arms) the connection row for the Evolution instance of this workspace.
create or replace function public.register_whatsapp_channel(p_instance_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_workspace_id uuid;
    v_member_id uuid;
    v_now timestamptz := now();
    v_connection public.channel_connections%rowtype;
    v_registered boolean := false;
begin
    select context.workspace_id, context.member_id
    into v_workspace_id, v_member_id
    from private.active_member_context() as context
    where context.member_role = 'owner';

    if v_member_id is null then
        raise exception 'whatsapp_channel_not_authorized' using errcode = '42501';
    end if;

    if p_instance_name is null or p_instance_name !~ '^[a-z0-9][a-z0-9-]{2,62}$' then
        raise exception 'invalid_whatsapp_instance_name' using errcode = '22023';
    end if;

    select * into v_connection
    from public.channel_connections as connection
    where connection.provider = 'whatsapp'
      and connection.external_account_id = p_instance_name
    for update;

    if found then
        if v_connection.workspace_id <> v_workspace_id then
            raise exception 'whatsapp_instance_in_use' using errcode = '42501';
        end if;

        if v_connection.status in ('disconnected', 'replaced') then
            update public.channel_connections
            set status = 'configured',
                activated_at = null,
                paused_at = null,
                disconnected_at = null
            where id = v_connection.id;
            v_registered := true;
        end if;
    else
        insert into public.channel_connections (
            workspace_id, provider, external_account_id, display_name, status
        )
        values (v_workspace_id, 'whatsapp', p_instance_name, 'WhatsApp', 'configured')
        returning * into v_connection;
        v_registered := true;
    end if;

    if v_registered then
        insert into public.audit_events (
            workspace_id, actor_type, actor_member_id, action, target_type,
            target_id, result, metadata, occurred_at, recorded_at
        )
        values (
            v_workspace_id, 'member', v_member_id, 'whatsapp.channel_registered',
            'channel_connection', v_connection.id, 'success',
            jsonb_build_object('provider', 'whatsapp'), v_now, v_now
        );
    end if;

    return jsonb_build_object(
        'status', 'success',
        'connection_id', v_connection.id,
        'connection_status', (select connection.status from public.channel_connections as connection where connection.id = v_connection.id)
    );
end;
$function$;

-- OWNER: applies the state the app just read from the provider ('open' with the number, or 'close').
create or replace function public.confirm_whatsapp_channel_state(
    p_instance_name text,
    p_state text,
    p_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_workspace_id uuid;
    v_member_id uuid;
    v_connection_id uuid;
begin
    select context.workspace_id, context.member_id
    into v_workspace_id, v_member_id
    from private.active_member_context() as context
    where context.member_role = 'owner';

    if v_member_id is null then
        raise exception 'whatsapp_channel_not_authorized' using errcode = '42501';
    end if;

    select connection.id into v_connection_id
    from public.channel_connections as connection
    where connection.workspace_id = v_workspace_id
      and connection.provider = 'whatsapp'
      and connection.external_account_id = p_instance_name;

    if v_connection_id is null then
        raise exception 'whatsapp_channel_not_found' using errcode = 'P0002';
    end if;

    return private.apply_whatsapp_channel_state(v_connection_id, p_state, p_phone, v_member_id);
end;
$function$;

-- Server (service_role): applies a state reported by the provider webhook (CONNECTION_UPDATE).
create or replace function public.sync_whatsapp_channel_state(
    p_instance_name text,
    p_state text,
    p_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_connection_id uuid;
begin
    select connection.id into v_connection_id
    from public.channel_connections as connection
    where connection.provider = 'whatsapp'
      and connection.external_account_id = p_instance_name;

    if v_connection_id is null then
        return jsonb_build_object('status', 'ignored', 'reason', 'unknown_instance');
    end if;

    return private.apply_whatsapp_channel_state(v_connection_id, p_state, p_phone, null);
end;
$function$;

alter function public.register_whatsapp_channel(text) owner to postgres;
alter function public.confirm_whatsapp_channel_state(text, text, text) owner to postgres;
alter function public.sync_whatsapp_channel_state(text, text, text) owner to postgres;

revoke all on function public.register_whatsapp_channel(text) from public, anon, service_role;
revoke all on function public.confirm_whatsapp_channel_state(text, text, text) from public, anon, service_role;
revoke all on function public.sync_whatsapp_channel_state(text, text, text) from public, anon, authenticated;

grant execute on function public.register_whatsapp_channel(text) to authenticated;
grant execute on function public.confirm_whatsapp_channel_state(text, text, text) to authenticated;
grant execute on function public.sync_whatsapp_channel_state(text, text, text) to service_role;
