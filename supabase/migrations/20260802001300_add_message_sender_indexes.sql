-- Migration: 20260802001300_add_message_sender_indexes.sql
-- Descrição: Adiciona índices parciais otimizados em public.messages para sender_contact_point_id e internal_author_member_id.

create index idx_messages_sender_contact_point
on public.messages (workspace_id, sender_contact_point_id)
where sender_contact_point_id is not null;

create index idx_messages_internal_author
on public.messages (workspace_id, internal_author_member_id)
where internal_author_member_id is not null;
