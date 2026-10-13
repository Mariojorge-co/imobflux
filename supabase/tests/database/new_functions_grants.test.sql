begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

-- Permissões das funções criadas/alteradas pelas migrations 004300 a 004900:
--   * anon e PUBLIC nunca executam;
--   * service_role também NÃO executa (todas dependem de auth.uid(); com a chave de serviço o contexto é vazio);
--   * authenticated executa as funções públicas; as funções private só rodam dentro das públicas.
create temp table grant_targets (signature text primary key, schema_name text not null);
grant all on grant_targets to public;
insert into grant_targets values
    ('public.remove_team_member(uuid)', 'public'),
    ('public.prepare_team_invitation(text,text)', 'public'),
    ('public.assign_conversation(uuid,uuid)', 'public'),
    ('public.unassign_conversation(uuid,uuid)', 'public'),
    ('public.reassign_conversation(uuid,uuid,uuid)', 'public'),
    ('public.get_conversation_assignees(uuid)', 'public'),
    ('public.get_member_directory()', 'public'),
    ('public.get_audit_events(text,uuid,timestamptz,timestamptz,timestamptz,uuid,integer)', 'public'),
    ('public.create_work_task(text,text,timestamptz,text,uuid,text,timestamptz,uuid,uuid,uuid)', 'public'),
    ('public.update_work_task(uuid,text,timestamptz,text,text,text,timestamptz,boolean)', 'public'),
    ('public.reassign_work_task(uuid,uuid)', 'public'),
    ('public.cancel_work_task(uuid)', 'public'),
    ('public.complete_work_task(uuid)', 'public'),
    ('public.upsert_work_task(text,text,timestamptz,uuid,uuid,uuid,uuid)', 'public'),
    ('public.get_work_tasks(text,text,integer)', 'public'),
    ('public.export_dataset(text)', 'public'),
    ('public.get_conversations_inbox(text,text,timestamptz,uuid,integer)', 'public'),
    ('public.update_whatsapp_ingest_settings(boolean,boolean,integer)', 'public'),
    ('public.link_opportunity_conversation(uuid,uuid)', 'public'),
    ('public.update_contact_opportunity_qualification(uuid,uuid,text,text,text,numeric,numeric,text,numeric,text,numeric,text,text)', 'public'),
    ('private.is_conversation_team_visible(uuid)', 'private'),
    ('private.is_task_context_team_visible(uuid,uuid,uuid)', 'private'),
    ('private.member_display_name(uuid,uuid)', 'private');

select plan(8);

select is(
    (select count(*) from grant_targets t where to_regprocedure(t.signature) is null),
    0::bigint,
    'todas as funções da lista existem (a lista está atualizada)'
);

select is(
    (select string_agg(t.signature, ', ' order by t.signature) from grant_targets t
     where to_regprocedure(t.signature) is not null and pg_catalog.has_function_privilege('anon', to_regprocedure(t.signature), 'execute')),
    null,
    'anon não executa nenhuma delas'
);

select is(
    (select string_agg(t.signature, ', ' order by t.signature) from grant_targets t
     where to_regprocedure(t.signature) is not null and pg_catalog.has_function_privilege('service_role', to_regprocedure(t.signature), 'execute')),
    null,
    'service_role não executa nenhuma delas'
);

select is(
    (select count(*) from grant_targets t
     where t.schema_name = 'public' and to_regprocedure(t.signature) is not null
       and not pg_catalog.has_function_privilege('authenticated', to_regprocedure(t.signature), 'execute')),
    0::bigint,
    'authenticated executa todas as funções públicas da lista'
);

select is(
    (select string_agg(t.signature, ', ' order by t.signature) from grant_targets t
     where t.schema_name = 'private' and t.signature not like 'private.member_display_name%'
       and to_regprocedure(t.signature) is not null and pg_catalog.has_function_privilege('authenticated', to_regprocedure(t.signature), 'execute')),
    null,
    'as funções private auxiliares não são executáveis por authenticated (só dentro das funções públicas)'
);

select ok(
    pg_catalog.has_function_privilege('authenticated', 'private.member_display_name(uuid,uuid)', 'execute'),
    'private.member_display_name é a exceção: a lista de conversas (invoker) precisa chamá-la'
);

select is(
    (select count(*) from grant_targets t
     where to_regprocedure(t.signature) is not null
       and not (select p.prosecdef from pg_catalog.pg_proc p where p.oid = to_regprocedure(t.signature))
       and t.signature not like 'public.get_work_tasks%' and t.signature not like 'public.get_conversations_inbox%'),
    0::bigint,
    'toda função da lista é SECURITY DEFINER, exceto as de leitura que rodam como o chamador (RLS aplica)'
);

select is(
    (select count(*) from grant_targets t
     where to_regprocedure(t.signature) is not null
       and not exists (
           select 1 from pg_catalog.pg_proc p
           where p.oid = to_regprocedure(t.signature)
             and p.proconfig is not null and 'search_path=""' = any (p.proconfig)
       )),
    0::bigint,
    'todas fixam search_path vazio'
);

select * from finish();
rollback;
