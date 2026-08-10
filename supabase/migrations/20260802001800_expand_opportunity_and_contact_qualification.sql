-- ImobFlux Sprint 21: Expansion of opportunities status, qualification fields and OWNER-only financials table.

-- 1. Alterar Constraints de Status e Closure na tabela public.opportunities

alter table public.opportunities
    drop constraint ck_opportunities_status,
    drop constraint ck_opportunities_closure;

alter table public.opportunities
    add constraint ck_opportunities_status
        check (status in ('open', 'won', 'lost', 'rework', 'cancelled')),
    add constraint ck_opportunities_closure
        check (
            (status in ('open', 'rework') and closed_at is null)
            or (status in ('won', 'lost', 'cancelled') and closed_at is not null)
        );

-- 2. Adicionar campos de qualificação, fotografia comercial/financeira e encerramento em public.opportunities

alter table public.opportunities
    add column origin text,
    add column property_summary text,
    add column operation_type text,
    add column property_type_preference text,
    add column city_region_preference text,
    add column value_range_preference text,
    add column down_payment_available numeric(14, 2),
    add column timeframe_intent text,
    add column preferences_notes text,
    add column rework_reason text,
    add column rework_reevaluation_date timestamptz,
    add column loss_reason text,
    add column loss_notes text,
    add column family_income numeric(14, 2),
    add column financial_analysis_status text default 'not_analyzed',
    add column approved_amount numeric(14, 2),
    add column financial_notes text,
    add column documentation_status text default 'not_sent';

-- Constraints para os novos campos de public.opportunities

alter table public.opportunities
    add constraint ck_opportunities_origin_nonempty
        check (origin is null or btrim(origin) <> ''),
    add constraint ck_opportunities_property_summary_nonempty
        check (property_summary is null or btrim(property_summary) <> ''),
    add constraint ck_opportunities_operation_type_nonempty
        check (operation_type is null or btrim(operation_type) <> ''),
    add constraint ck_opportunities_down_payment_positive
        check (down_payment_available is null or down_payment_available >= 0),
    add constraint ck_opportunities_family_income_positive
        check (family_income is null or family_income >= 0),
    add constraint ck_opportunities_approved_amount_positive
        check (approved_amount is null or approved_amount >= 0),
    add constraint ck_opportunities_financial_analysis_status
        check (
            financial_analysis_status is null
            or financial_analysis_status in (
                'not_analyzed',
                'in_analysis',
                'approved',
                'conditioned',
                'rejected'
            )
        ),
    add constraint ck_opportunities_documentation_status
        check (
            documentation_status is null
            or documentation_status in ('not_sent', 'pending', 'complete')
        ),
    add constraint ck_opportunities_rework_reason_nonempty
        check (rework_reason is null or btrim(rework_reason) <> ''),
    add constraint ck_opportunities_loss_reason_nonempty
        check (loss_reason is null or btrim(loss_reason) <> '');

-- Index para busca de retrabalho por data de reavaliação
create index idx_opportunities_rework_reevaluation
    on public.opportunities (workspace_id, rework_reevaluation_date)
    where status = 'rework';


-- 3. Criar a tabela isolada public.opportunity_financials (OWNER-only)

create table public.opportunity_financials (
    id uuid default gen_random_uuid() not null,
    workspace_id uuid not null,
    opportunity_id uuid not null,
    business_value numeric(14, 2),
    commission_expected numeric(14, 2),
    commission_received numeric(14, 2),
    created_at timestamptz default now() not null,
    updated_at timestamptz default now() not null,

    constraint pk_opportunity_financials primary key (id),
    constraint uq_opportunity_financials_workspace_opp
        unique (workspace_id, opportunity_id),
    constraint fk_opportunity_financials_workspace
        foreign key (workspace_id)
        references public.workspaces (id)
        on delete restrict,
    constraint fk_opportunity_financials_opportunity
        foreign key (workspace_id, opportunity_id)
        references public.opportunities (workspace_id, id)
        on delete restrict,
    constraint ck_opportunity_financials_business_value_positive
        check (business_value is null or business_value >= 0),
    constraint ck_opportunity_financials_commission_expected_positive
        check (commission_expected is null or commission_expected >= 0),
    constraint ck_opportunity_financials_commission_received_positive
        check (commission_received is null or commission_received >= 0),
    constraint ck_opportunity_financials_timestamps
        check (updated_at >= created_at)
);

create index idx_opportunity_financials_opp
    on public.opportunity_financials (workspace_id, opportunity_id);

-- Trigger de updated_at reutilizando public.set_updated_at()
create trigger trg_opportunity_financials_updated_at
    before update on public.opportunity_financials
    for each row
    execute function public.set_updated_at();

-- Habilitar e forçar RLS
alter table public.opportunity_financials enable row level security;
alter table public.opportunity_financials force row level security;

-- Política RLS estrita: Somente membros com papel 'owner' possuem acesso de leitura/escrita
create policy owner_financials_only on public.opportunity_financials
    for all to authenticated
    using (
        workspace_id in (
            select owner_context.workspace_id
            from private.active_owner_context() as owner_context
        )
    )
    with check (
        workspace_id in (
            select owner_context.workspace_id
            from private.active_owner_context() as owner_context
        )
    );

-- Privilégios mínimos
revoke all privileges on table public.opportunity_financials from public, anon, authenticated;
grant select, insert, update on table public.opportunity_financials to authenticated;
grant select, insert, update on table public.opportunity_financials to service_role;
