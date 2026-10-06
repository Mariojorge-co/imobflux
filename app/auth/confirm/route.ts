import type { EmailOtpType } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
const PENDING_TOKEN_COOKIE = "imobflux_pending_auth_token";
const PENDING_TYPE_COOKIE = "imobflux_pending_auth_type";

export async function GET(request: Request) {
  const url = new URL(request.url);
  let tokenHash = url.searchParams.get("token_hash");
  let type = url.searchParams.get("type") as EmailOtpType | null;
  const resume = url.searchParams.get("resume") === "1";
  const nextPath = url.searchParams.get("next") === "/redefinir-senha" ? "/redefinir-senha" : "/convite";
  const destination = new URL(nextPath, url.origin);

  if ((!resume && !tokenHash) || (!resume && type !== "invite" && type !== "recovery")) {
    destination.searchParams.set("error", "invalid");
    return NextResponse.redirect(destination);
  }

  const supabase = await createServerSupabaseClient();
  const cookieStore = await cookies();
  const current = await supabase.auth.getUser();
  if (current.data.user) {
    if (!resume && tokenHash && type) {
      cookieStore.set(PENDING_TOKEN_COOKIE, tokenHash, { httpOnly: true, maxAge: 600, path: "/", sameSite: "lax", secure: process.env.NODE_ENV === "production" });
      cookieStore.set(PENDING_TYPE_COOKIE, type, { httpOnly: true, maxAge: 600, path: "/", sameSite: "lax", secure: process.env.NODE_ENV === "production" });
    }
    const conflict = new URL(nextPath, url.origin);
    conflict.searchParams.set("error", "session_conflict");
    conflict.searchParams.set("flow", type ?? cookieStore.get(PENDING_TYPE_COOKIE)?.value ?? "invite");
    return NextResponse.redirect(conflict);
  }
  if (resume) {
    tokenHash = cookieStore.get(PENDING_TOKEN_COOKIE)?.value ?? null;
    type = (cookieStore.get(PENDING_TYPE_COOKIE)?.value ?? null) as EmailOtpType | null;
    cookieStore.delete(PENDING_TOKEN_COOKIE);
    cookieStore.delete(PENDING_TYPE_COOKIE);
  }
  if (!tokenHash || (type !== "invite" && type !== "recovery")) {
    destination.searchParams.set("error", "invalid");
    return NextResponse.redirect(destination);
  }
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });

  if (error) {
    destination.searchParams.set(
      "error",
      error.code === "otp_expired" ? "expired" : "invalid",
    );
  } else if (type === "recovery" && nextPath === "/convite") {
    destination.searchParams.set("flow", "recovery");
  }

  return NextResponse.redirect(destination);
}
