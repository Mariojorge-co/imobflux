-- ImobFlux Sprint 25: accept canonical E.164 contact phones while keeping
-- Brazilian national input as the manual-entry default.

create or replace function public.normalize_brazilian_phone(p_value text)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $function$
declare
    v_digits text := pg_catalog.regexp_replace(p_value, '[^0-9]', '', 'g');
begin
    if p_value like '+%' then
        if v_digits ~ '^[1-9][0-9]{7,14}$' then
            return '+' || v_digits;
        end if;
        return null;
    end if;

    if pg_catalog.length(v_digits) in (10, 11) then
        return '+55' || v_digits;
    end if;

    -- WhatsApp providers may deliver an international JID without '+'.
    if pg_catalog.length(v_digits) between 12 and 15
       and v_digits ~ '^[1-9][0-9]{11,14}$' then
        return '+' || v_digits;
    end if;

    return null;
end;
$function$;

alter function public.normalize_brazilian_phone(text) owner to postgres;
revoke all on function public.normalize_brazilian_phone(text) from public, anon, service_role;
grant execute on function public.normalize_brazilian_phone(text) to authenticated;

create or replace function public.create_contact(
    p_display_name text,
    p_classification text,
    p_phone_normalized text default null,
    p_phone_display_value text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
    v_context_count bigint;
    v_workspace_id uuid;
    v_member_id uuid;
    v_contact_id uuid;
    v_display_name text;
    v_phone_normalized text;
    v_phone_display_value text;
    v_occurred_at timestamptz := pg_catalog.statement_timestamp();
    v_constraint_name text;
begin
    select count(*) into v_context_count from private.active_owner_context();
    if v_context_count <> 1 then
        raise exception 'contact_operation_not_authorized' using errcode = '42501';
    end if;

    select workspace_id, member_id into v_workspace_id, v_member_id
    from private.active_owner_context();

    v_display_name := pg_catalog.btrim(p_display_name);
    if v_display_name is null or v_display_name = '' then
        raise exception 'contact_display_name_invalid' using errcode = '22023';
    end if;
    if p_classification is null or p_classification not in ('person', 'lead', 'client') then
        raise exception 'contact_classification_invalid' using errcode = '22023';
    end if;

    if p_phone_normalized is not null or p_phone_display_value is not null then
        if p_phone_normalized is null or p_phone_display_value is null then
            raise exception 'contact_phone_invalid' using errcode = '22023';
        end if;
        v_phone_normalized := pg_catalog.btrim(p_phone_normalized);
        v_phone_display_value := pg_catalog.btrim(p_phone_display_value);
        if v_phone_normalized !~ '^\+[1-9][0-9]{7,14}$' or v_phone_display_value = '' then
            raise exception 'contact_phone_invalid' using errcode = '22023';
        end if;
    end if;

    insert into public.contacts (workspace_id, display_name, classification, operational_status, is_protected)
    values (v_workspace_id, v_display_name, p_classification, 'active', false)
    returning id into v_contact_id;

    if v_phone_normalized is not null then
        insert into public.contact_points (
            workspace_id, contact_id, point_type, normalized_value, display_value,
            operational_status, is_protected
        ) values (
            v_workspace_id, v_contact_id, 'phone', v_phone_normalized,
            v_phone_display_value, 'active', false
        );
    end if;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type, target_id,
        result, metadata, occurred_at, recorded_at
    ) values (
        v_workspace_id, 'member', v_member_id, 'contact.created', 'contact', v_contact_id,
        'success', pg_catalog.jsonb_build_object('phone_provided', v_phone_normalized is not null),
        v_occurred_at, v_occurred_at
    );
    return v_contact_id;
exception
    when unique_violation then
        get stacked diagnostics v_constraint_name = constraint_name;
        if v_constraint_name = 'uq_contact_points_normalized_identity' then
            raise exception 'contact_phone_duplicate' using errcode = '23505';
        end if;
        raise;
end;
$function$;

create or replace function public.update_contact(
    p_contact_id uuid,
    p_display_name text,
    p_classification text,
    p_phone_normalized text default null,
    p_phone_display_value text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
    v_context_count bigint;
    v_workspace_id uuid;
    v_member_id uuid;
    v_contact_id uuid;
    v_display_name text;
    v_phone_normalized text;
    v_phone_display_value text;
    v_phone_id uuid;
    v_current_phone_normalized text;
    v_current_phone_display_value text;
    v_active_phone_count bigint;
    v_contact_changed boolean := false;
    v_phone_changed boolean := false;
    v_occurred_at timestamptz := pg_catalog.statement_timestamp();
    v_constraint_name text;
begin
    select count(*) into v_context_count from private.active_owner_context();
    if v_context_count <> 1 then
        raise exception 'contact_operation_not_authorized' using errcode = '42501';
    end if;
    select workspace_id, member_id into v_workspace_id, v_member_id
    from private.active_owner_context();

    select id into v_contact_id from public.contacts
    where id = p_contact_id and workspace_id = v_workspace_id for update;
    if not found then
        raise exception 'contact_not_found' using errcode = 'P0001';
    end if;

    v_display_name := pg_catalog.btrim(p_display_name);
    if v_display_name is null or v_display_name = '' then
        raise exception 'contact_display_name_invalid' using errcode = '22023';
    end if;
    if p_classification is null or p_classification not in ('person', 'lead', 'client') then
        raise exception 'contact_classification_invalid' using errcode = '22023';
    end if;

    if p_phone_normalized is not null or p_phone_display_value is not null then
        if p_phone_normalized is null or p_phone_display_value is null then
            raise exception 'contact_phone_invalid' using errcode = '22023';
        end if;
        v_phone_normalized := pg_catalog.btrim(p_phone_normalized);
        v_phone_display_value := pg_catalog.btrim(p_phone_display_value);
        if v_phone_normalized !~ '^\+[1-9][0-9]{7,14}$' or v_phone_display_value = '' then
            raise exception 'contact_phone_invalid' using errcode = '22023';
        end if;
    end if;

    select count(*) into v_active_phone_count from public.contact_points
    where workspace_id = v_workspace_id and contact_id = v_contact_id
      and point_type = 'phone' and operational_status = 'active';
    if v_active_phone_count > 1 then
        raise exception 'contact_phone_state_unsupported' using errcode = 'P0001';
    end if;
    if v_active_phone_count = 1 then
        select id, normalized_value, display_value
        into v_phone_id, v_current_phone_normalized, v_current_phone_display_value
        from public.contact_points
        where workspace_id = v_workspace_id and contact_id = v_contact_id
          and point_type = 'phone' and operational_status = 'active'
        for update;
    end if;

    update public.contacts set display_name = v_display_name, classification = p_classification
    where id = v_contact_id and workspace_id = v_workspace_id
      and (display_name is distinct from v_display_name or classification is distinct from p_classification);
    v_contact_changed := found;

    if v_phone_normalized is null and v_phone_id is not null then
        update public.contact_points set operational_status = 'inactive', inactive_at = v_occurred_at
        where id = v_phone_id and workspace_id = v_workspace_id;
        v_phone_changed := true;
    elsif v_phone_normalized is not null and v_phone_id is null then
        insert into public.contact_points (
            workspace_id, contact_id, point_type, normalized_value, display_value,
            operational_status, is_protected
        ) values (
            v_workspace_id, v_contact_id, 'phone', v_phone_normalized,
            v_phone_display_value, 'active', false
        );
        v_phone_changed := true;
    elsif v_phone_id is not null and (
        v_current_phone_normalized is distinct from v_phone_normalized
        or v_current_phone_display_value is distinct from v_phone_display_value
    ) then
        update public.contact_points set normalized_value = v_phone_normalized, display_value = v_phone_display_value
        where id = v_phone_id and workspace_id = v_workspace_id;
        v_phone_changed := true;
    end if;

    if v_contact_changed or v_phone_changed then
        insert into public.audit_events (
            workspace_id, actor_type, actor_member_id, action, target_type, target_id,
            result, metadata, occurred_at, recorded_at
        ) values (
            v_workspace_id, 'member', v_member_id, 'contact.updated', 'contact', v_contact_id,
            'success', pg_catalog.jsonb_build_object(
                'contact_fields_changed', v_contact_changed,
                'phone_changed', v_phone_changed
            ), v_occurred_at, v_occurred_at
        );
    end if;
    return v_contact_id;
exception
    when unique_violation then
        get stacked diagnostics v_constraint_name = constraint_name;
        if v_constraint_name = 'uq_contact_points_normalized_identity' then
            raise exception 'contact_phone_duplicate' using errcode = '23505';
        end if;
        raise;
end;
$function$;

alter function public.create_contact(text, text, text, text) owner to postgres;
alter function public.update_contact(uuid, text, text, text, text) owner to postgres;
revoke all on function public.create_contact(text, text, text, text) from public, anon, service_role;
revoke all on function public.update_contact(uuid, text, text, text, text) from public, anon, service_role;
grant execute on function public.create_contact(text, text, text, text) to authenticated;
grant execute on function public.update_contact(uuid, text, text, text, text) to authenticated;
