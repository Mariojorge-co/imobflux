-- ImobFlux Sprint 25: preserve the Brazilian 10/11-digit rule after
-- international E.164 support was added in migration 34.

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
        if v_digits like '55%' then
            if v_digits ~ '^55[0-9]{10,11}$' then
                return '+' || v_digits;
            end if;
            return null;
        end if;

        if v_digits ~ '^[1-9][0-9]{7,14}$' then
            return '+' || v_digits;
        end if;
        return null;
    end if;

    if pg_catalog.length(v_digits) in (10, 11) then
        return '+55' || v_digits;
    end if;

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
