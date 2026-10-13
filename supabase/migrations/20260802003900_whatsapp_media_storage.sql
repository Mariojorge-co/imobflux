-- ImobFlux: private storage for WhatsApp media and the attachment download lifecycle.
--
-- Attachment states:
--   pending      the file is being downloaded from the provider (or a retry is running)
--   unavailable  the download failed or has not run; the UI shows a notice and a retry button
--   available    the file is stored in the private bucket and can be viewed in the conversation
-- Files live in the private 'whatsapp-media' bucket (no storage policies: only the server, with
-- the service role, can read or write; users reach a file only through the authorised
-- /api/attachments/[id] route, which relies on the attachments RLS and its privacy rules).

insert into storage.buckets (id, name, public, file_size_limit)
values ('whatsapp-media', 'whatsapp-media', false, 26214400)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit;

-- New attachments start as 'pending' (a download is scheduled right after ingestion).
create or replace function public.attach_whatsapp_media(
    p_message_id uuid,
    p_media_kind text,
    p_file_name text,
    p_mime_type text,
    p_size_bytes bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_workspace_id uuid;
    v_origin text;
    v_existing_id uuid;
    v_existing_status text;
    v_attachment_id uuid := gen_random_uuid();
    v_kind text := lower(btrim(coalesce(p_media_kind, '')));
    v_name text;
    v_mime text;
    v_size bigint;
begin
    if v_kind not in ('image', 'document', 'audio', 'video', 'sticker') then
        return jsonb_build_object('status', 'ignored', 'reason', 'invalid_media_kind');
    end if;

    -- Serializes concurrent webhook retries for the same message.
    perform pg_advisory_xact_lock(hashtextextended(p_message_id::text, 0));

    select message.workspace_id, message.origin
    into v_workspace_id, v_origin
    from public.messages as message
    where message.id = p_message_id;

    if v_workspace_id is null then
        raise exception 'message_not_found' using errcode = 'P0002';
    end if;

    if v_origin <> 'whatsapp' then
        return jsonb_build_object('status', 'ignored', 'reason', 'not_whatsapp_message');
    end if;

    select attachment.id, attachment.status
    into v_existing_id, v_existing_status
    from public.attachments as attachment
    where attachment.workspace_id = v_workspace_id
      and attachment.message_id = p_message_id
    order by attachment.created_at, attachment.id
    limit 1;

    if v_existing_id is not null then
        return jsonb_build_object(
            'status', 'duplicate',
            'attachment_id', v_existing_id,
            'attachment_status', v_existing_status
        );
    end if;

    v_name := nullif(btrim(translate(coalesce(p_file_name, ''), '/' || chr(92), '__')), '');
    v_name := left(
        coalesce(
            v_name,
            case v_kind
                when 'image' then 'imagem'
                when 'audio' then 'audio'
                when 'video' then 'video'
                when 'sticker' then 'figurinha'
                else 'documento'
            end
        ),
        255
    );
    v_mime := left(coalesce(nullif(btrim(p_mime_type), ''), 'application/octet-stream'), 127);
    v_size := case when coalesce(p_size_bytes, 0) > 0 then p_size_bytes else 0 end;

    insert into public.attachments (
        id, workspace_id, message_id, storage_bucket, storage_key,
        original_file_name, mime_type, size_bytes, status
    )
    values (
        v_attachment_id,
        v_workspace_id,
        p_message_id,
        'whatsapp-media',
        v_workspace_id::text || '/' || p_message_id::text || '/' || v_attachment_id::text,
        v_name,
        v_mime,
        v_size,
        'pending'
    );

    return jsonb_build_object(
        'status', 'success',
        'attachment_id', v_attachment_id,
        'attachment_status', 'pending'
    );
end;
$function$;

alter function public.attach_whatsapp_media(uuid, text, text, text, bigint) owner to postgres;
revoke all on function public.attach_whatsapp_media(uuid, text, text, text, bigint)
from public, anon, authenticated;
grant execute on function public.attach_whatsapp_media(uuid, text, text, text, bigint)
to service_role;

-- Marks the file as stored. Idempotent: an already available attachment is left untouched.
create or replace function public.mark_attachment_available(
    p_attachment_id uuid,
    p_size_bytes bigint,
    p_mime_type text,
    p_sha256 text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_status text;
begin
    if coalesce(p_size_bytes, 0) <= 0 then
        raise exception 'invalid_attachment_size' using errcode = '22023';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(p_attachment_id::text, 0));

    select attachment.status
    into v_status
    from public.attachments as attachment
    where attachment.id = p_attachment_id;

    if v_status is null then
        return jsonb_build_object('status', 'not_found');
    end if;

    if v_status = 'available' then
        return jsonb_build_object('status', 'duplicate');
    end if;

    if v_status = 'archived' then
        return jsonb_build_object('status', 'ignored', 'reason', 'archived');
    end if;

    update public.attachments
    set status = 'available',
        available_at = greatest(statement_timestamp(), created_at),
        size_bytes = p_size_bytes,
        mime_type = left(coalesce(nullif(btrim(p_mime_type), ''), mime_type), 127),
        sha256 = case when p_sha256 ~ '^[0-9A-Fa-f]{64}$' then lower(p_sha256) else sha256 end
    where id = p_attachment_id;

    return jsonb_build_object('status', 'success');
end;
$function$;

-- Moves a not-yet-stored attachment between 'pending' (download running) and 'unavailable'
-- (failed). It never touches an available or archived attachment.
create or replace function public.mark_attachment_download_state(
    p_attachment_id uuid,
    p_state text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_status text;
begin
    if p_state not in ('pending', 'unavailable') then
        raise exception 'invalid_attachment_state' using errcode = '22023';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(p_attachment_id::text, 0));

    select attachment.status
    into v_status
    from public.attachments as attachment
    where attachment.id = p_attachment_id;

    if v_status is null then
        return jsonb_build_object('status', 'not_found');
    end if;

    if v_status not in ('pending', 'unavailable') then
        return jsonb_build_object('status', 'ignored', 'reason', v_status);
    end if;

    update public.attachments
    set status = p_state
    where id = p_attachment_id;

    return jsonb_build_object('status', 'success', 'attachment_status', p_state);
end;
$function$;

-- Everything the server needs to download one attachment (where to store it and how to ask the
-- provider for it). The service role has no direct table privileges, so it reads through here.
create or replace function public.get_attachment_download_context(p_attachment_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
    select jsonb_build_object(
        'attachment_id', attachment.id,
        'storage_bucket', attachment.storage_bucket,
        'storage_key', attachment.storage_key,
        'status', attachment.status,
        'mime_type', attachment.mime_type,
        'instance', connection.external_account_id,
        'external_message_id', message.external_message_id,
        'from_me', message.direction = 'outgoing',
        'remote_jid', conversation.external_thread_id,
        'conversation_type', conversation.conversation_type,
        'participant_phone', case when conversation.conversation_type = 'group' then point.normalized_value end
    )
    from public.attachments as attachment
    join public.messages as message
      on message.workspace_id = attachment.workspace_id
     and message.id = attachment.message_id
    join public.channel_connections as connection
      on connection.workspace_id = message.workspace_id
     and connection.id = message.channel_connection_id
    join public.conversations as conversation
      on conversation.workspace_id = message.workspace_id
     and conversation.id = message.conversation_id
    left join public.contact_points as point
      on point.workspace_id = message.workspace_id
     and point.id = message.sender_contact_point_id
    where attachment.id = p_attachment_id;
$function$;

alter function public.get_attachment_download_context(uuid) owner to postgres;
revoke all on function public.get_attachment_download_context(uuid) from public, anon, authenticated;
grant execute on function public.get_attachment_download_context(uuid) to service_role;

alter function public.mark_attachment_available(uuid, bigint, text, text) owner to postgres;
alter function public.mark_attachment_download_state(uuid, text) owner to postgres;
revoke all on function public.mark_attachment_available(uuid, bigint, text, text)
from public, anon, authenticated;
revoke all on function public.mark_attachment_download_state(uuid, text)
from public, anon, authenticated;
grant execute on function public.mark_attachment_available(uuid, bigint, text, text) to service_role;
grant execute on function public.mark_attachment_download_state(uuid, text) to service_role;

-- The read model also exposes the attachment creation time so the UI can tell a download in
-- progress from one that never finished.
create or replace function public.get_conversation_messages(
    p_conversation_id uuid,
    p_cursor_occurred_at timestamptz default null,
    p_cursor_id uuid default null,
    p_limit integer default 50
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
    with bounded as (
        select greatest(1, least(coalesce(p_limit, 50), 100)) as page_size
    ),
    page as (
        select
            message.id,
            message.direction,
            message.origin,
            message.status,
            message.text_content,
            message.occurred_at,
            author_user.display_name as internal_author_name,
            sender.external_display_name as sender_display_name,
            exists (
                select 1
                from public.attachments as attachment
                where attachment.message_id = message.id
            ) as has_attachments,
            coalesce((
                select jsonb_agg(
                    jsonb_build_object(
                        'id', attachment.id,
                        'file_name', attachment.original_file_name,
                        'mime_type', attachment.mime_type,
                        'size_bytes', attachment.size_bytes,
                        'status', attachment.status,
                        'created_at', attachment.created_at
                    ) order by attachment.created_at, attachment.id
                )
                from public.attachments as attachment
                where attachment.message_id = message.id
            ), '[]'::jsonb) as attachments
        from public.messages as message
        left join public.workspace_members as author_member
          on author_member.workspace_id = message.workspace_id
         and author_member.id = message.internal_author_member_id
        left join public.app_users as author_user
          on author_user.id = author_member.user_id
        left join public.conversation_participants as sender
          on sender.workspace_id = message.workspace_id
         and sender.conversation_id = message.conversation_id
         and sender.contact_point_id = message.sender_contact_point_id
         and sender.left_at is null
        where message.conversation_id = p_conversation_id
          and (
              p_cursor_occurred_at is null
              or (message.occurred_at, message.id) < (p_cursor_occurred_at, p_cursor_id)
          )
        order by message.occurred_at desc, message.id desc
        limit (select page_size + 1 from bounded)
    ),
    visible_page as (
        select *
        from page
        order by occurred_at desc, id desc
        limit (select page_size from bounded)
    )
    select jsonb_build_object(
        'messages', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'id', item.id,
                    'direction', item.direction,
                    'origin', item.origin,
                    'status', item.status,
                    'text_content', item.text_content,
                    'occurred_at', item.occurred_at,
                    'internal_author_name', item.internal_author_name,
                    'sender_display_name', item.sender_display_name,
                    'has_attachments', item.has_attachments,
                    'attachments', item.attachments
                ) order by item.occurred_at, item.id
            )
            from visible_page as item
        ), '[]'::jsonb),
        'has_more', (select count(*) > (select page_size from bounded) from page)
    );
$function$;

revoke all on function public.get_conversation_messages(uuid, timestamptz, uuid, integer)
from public, anon, service_role;
grant execute on function public.get_conversation_messages(uuid, timestamptz, uuid, integer)
to authenticated;
