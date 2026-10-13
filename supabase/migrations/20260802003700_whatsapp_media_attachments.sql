-- ImobFlux: WhatsApp media messages (image, document/PDF, audio, video, sticker).
-- The webhook now ingests a media message like any other message (so the conversation
-- history and the SLA see it) and records the attachment metadata here. The binary is not
-- downloaded yet: the attachment stays 'unavailable' until a future download step.

-- Media metadata often has no reliable size. Zero is allowed only while the file is not stored.
alter table public.attachments drop constraint if exists ck_attachments_size_positive;
alter table public.attachments
    add constraint ck_attachments_size_valid
    check (
        size_bytes > 0
        or (size_bytes = 0 and status in ('pending', 'unavailable'))
    );

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

    select attachment.id
    into v_existing_id
    from public.attachments as attachment
    where attachment.workspace_id = v_workspace_id
      and attachment.message_id = p_message_id
    order by attachment.created_at, attachment.id
    limit 1;

    if v_existing_id is not null then
        return jsonb_build_object('status', 'duplicate', 'attachment_id', v_existing_id);
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
        'unavailable'
    );

    return jsonb_build_object('status', 'success', 'attachment_id', v_attachment_id);
end;
$function$;

alter function public.attach_whatsapp_media(uuid, text, text, text, bigint) owner to postgres;
revoke all on function public.attach_whatsapp_media(uuid, text, text, text, bigint)
from public, anon, authenticated;
grant execute on function public.attach_whatsapp_media(uuid, text, text, text, bigint)
to service_role;

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
                        'status', attachment.status
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
