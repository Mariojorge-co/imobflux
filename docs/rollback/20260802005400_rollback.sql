-- ROLLBACK da migration 20260802005400_outgoing_media.sql (manual; NÃO é uma migration).
--
-- Remove as 3 funções novas do envio de arquivos. Nenhum dado é apagado: mensagens e anexos já criados por
-- queue_outgoing_media_message continuam na conversa (são linhas comuns de messages/attachments) e os arquivos
-- continuam no bucket. O app desta versão chama essas funções: faça o rollback do app antes ou junto.
-- Se a migration for considerada revertida: supabase migration repair --status reverted 20260802005400
-- Como usar (produção, só com autorização): begin; \i este-arquivo.sql; -- conferir; commit;

begin;

drop function if exists public.list_orphan_outbound_uploads(interval);
drop function if exists public.record_outgoing_media_sent(uuid, text);
drop function if exists public.queue_outgoing_media_message(uuid, uuid, text, text, text, bigint, text);

commit;
