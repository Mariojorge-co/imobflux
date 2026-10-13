import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { safeContentType, viewerKindForMime } from "@/lib/conversations/media-types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function contentDisposition(kind: ReturnType<typeof viewerKindForMime>, fileName: string) {
  const clean = fileName.replace(/[\u0000-\u001f\u007f"\\/]/g, "_").slice(0, 200) || "arquivo";
  const ascii = clean.replace(/[^\x20-\x7e]/g, "_");
  return `${kind === "file" ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}

/**
 * Entrega o arquivo de um anexo da conversa. O acesso é decidido pela RLS da tabela
 * attachments (a mesma regra de privacidade das mensagens: contato protegido, grupo não
 * liberado e marco temporal), nunca por um link público. O arquivo é repassado pela própria
 * origem do app, com suporte a Range (player de áudio/vídeo).
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ attachmentId: string }> },
) {
  const { attachmentId } = await context.params;
  if (!UUID.test(attachmentId)) return new NextResponse(null, { status: 404 });

  const supabase = await createServerSupabaseClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return new NextResponse(null, { status: 401 });

  const { data: attachment } = await supabase
    .from("attachments")
    .select("id, storage_bucket, storage_key, status, mime_type, original_file_name")
    .eq("id", attachmentId)
    .maybeSingle();
  if (!attachment) return new NextResponse(null, { status: 404 });
  if (attachment.status !== "available") return new NextResponse(null, { status: 409 });

  const admin = createAdminSupabaseClient();
  const { data: signed, error: signError } = await admin.storage
    .from(attachment.storage_bucket)
    .createSignedUrl(attachment.storage_key, 60);
  if (signError || !signed?.signedUrl) return new NextResponse(null, { status: 502 });

  const range = request.headers.get("range");
  let upstream: Response;
  try {
    upstream = await fetch(signed.signedUrl, {
      cache: "no-store",
      headers: range ? { Range: range } : {},
      signal: request.signal,
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
  if (upstream.status === 416) return new NextResponse(null, { status: 416 });
  if ((upstream.status !== 200 && upstream.status !== 206) || !upstream.body) {
    return new NextResponse(null, { status: 502 });
  }

  const contentType = safeContentType(attachment.mime_type);
  const kind = viewerKindForMime(contentType);
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    // Sem cache: se o acesso for revogado (contato protegido, grupo não liberado), a próxima
    // requisição precisa passar de novo pela autorização, nunca ser atendida do cache local.
    "Cache-Control": "private, no-store",
    "Content-Disposition": contentDisposition(kind, attachment.original_file_name),
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
  });
  if (kind === "file") headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
  for (const name of ["content-length", "content-range"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }

  return new NextResponse(upstream.body, { status: upstream.status, headers });
}
