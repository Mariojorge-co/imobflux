-- ROLLBACK da migration 20260802006600_quick_reply_attachments.sql (manual; NÃO é uma migration).
--
-- Remove as três funções e a tabela de anexos das respostas rápidas. As RESPOSTAS (texto e categorias) não são tocadas.
-- ATENÇÃO: os registros de anexo são apagados; os arquivos continuam no bucket privado 'whatsapp-media', sob
-- '<workspace>/quick-replies/...', e podem ser removidos depois pelo painel do Supabase (ou deixados: ficam inacessíveis).
-- O app desta versão usa estas funções: faça o rollback do app antes ou junto (as respostas continuam funcionando sem anexos).
-- Se a migration for considerada revertida: supabase migration repair --status reverted 20260802006600
-- Como usar (produção, só com autorização): begin; \i este-arquivo.sql; -- conferir; commit;

begin;

drop function if exists public.remove_quick_reply_attachment(uuid);
drop function if exists public.add_quick_reply_attachment(uuid, text, text, text, bigint, text);
drop function if exists public.get_quick_reply_attachments();
drop table if exists public.quick_reply_attachments;
alter table public.quick_replies drop constraint if exists uq_quick_replies_workspace_id;

commit;
