-- Sprint 25 corrective migration: sort_order-only updates are not semantic edits.

create or replace function public.set_opportunity_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
    if (
        pg_catalog.to_jsonb(old) - 'updated_at' - 'sort_order'
    ) is distinct from (
        pg_catalog.to_jsonb(new) - 'updated_at' - 'sort_order'
    ) then
        new.updated_at = pg_catalog.statement_timestamp();
    else
        new.updated_at = old.updated_at;
    end if;

    return new;
end;
$function$;

alter function public.set_opportunity_updated_at() owner to postgres;

drop trigger if exists trg_opportunities_set_updated_at on public.opportunities;

create trigger trg_opportunities_set_updated_at
before update on public.opportunities
for each row execute function public.set_opportunity_updated_at();
