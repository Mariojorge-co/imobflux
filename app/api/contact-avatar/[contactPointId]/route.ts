import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  context: { params: Promise<{ contactPointId: string }> },
) {
  const { contactPointId } = await context.params;
  if (!UUID.test(contactPointId)) return new NextResponse(null, { status: 404 });

  const supabase = await createServerSupabaseClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return new NextResponse(null, { status: 401 });

  const { data: point } = await supabase
    .from("contact_points")
    .select("external_avatar_url")
    .eq("id", contactPointId)
    .maybeSingle();
  if (!point?.external_avatar_url) return new NextResponse(null, { status: 404 });

  let avatarUrl: URL;
  try {
    avatarUrl = new URL(point.external_avatar_url);
  } catch {
    return new NextResponse(null, { status: 404 });
  }
  const hostname = avatarUrl.hostname.toLowerCase();
  const privateHost = hostname === "localhost" || hostname === "::1"
    || /^127\./.test(hostname) || /^10\./.test(hostname)
    || /^192\.168\./.test(hostname) || /^169\.254\./.test(hostname)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
  if (avatarUrl.protocol !== "https:" || privateHost) {
    return new NextResponse(null, { status: 404 });
  }

  const response = await fetch(avatarUrl, { cache: "no-store", redirect: "error" });
  if (!response.ok || !response.body) return new NextResponse(null, { status: 404 });
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) return new NextResponse(null, { status: 404 });

  return new NextResponse(response.body, {
    headers: {
      "Cache-Control": "private, max-age=300",
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
