-- ROLLBACK da migration 20260802005700_message_actions_schema.sql (manual; NÃO é uma migration).
--
-- ATENÇÃO: apaga as tabelas de reações, de textos de mensagens apagadas e de histórico de edições, e as colunas novas de
-- `messages` (citação, edição, exclusão, ocultação, encaminhada). Mensagens apagadas para todos voltam SEM texto (o
-- original só existia em message_deletions): exporte antes se precisar. Rollback do 005800 primeiro.
-- Se a migration for considerada revertida: supabase migration repair --status reverted 20260802005700
-- Como usar (produção, só com autorização): begin; \i este-arquivo.sql; -- conferir; commit;

begin;

drop table if exists public.message_reactions;
drop table if exists public.message_deletions;
drop table if exists public.message_edits;
drop index if exists public.idx_messages_reply_to;
alter table public.messages
    drop constraint if exists fk_messages_reply_to,
    drop constraint if exists fk_messages_forwarded_from,
    drop constraint if exists fk_messages_deleted_by,
    drop constraint if exists fk_messages_hidden_by,
    drop constraint if exists ck_messages_deleted_source,
    drop constraint if exists ck_messages_deleted_consistent,
    drop constraint if exists ck_messages_hidden_consistent,
    drop constraint if exists ck_messages_edit_count,
    drop constraint if exists ck_messages_reply_external_nonempty;
alter table public.messages
    drop column if exists reply_to_message_id,
    drop column if exists reply_to_external_id,
    drop column if exists reply_snapshot,
    drop column if exists edited_at,
    drop column if exists edit_count,
    drop column if exists deleted_at,
    drop column if exists deleted_by_member_id,
    drop column if exists deleted_source,
    drop column if exists hidden_at,
    drop column if exists hidden_by_member_id,
    drop column if exists forwarded,
    drop column if exists forwarded_from_message_id;

commit;
