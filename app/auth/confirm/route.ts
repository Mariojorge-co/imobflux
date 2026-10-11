import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  authFlowDestination, clearConfirmedFlow, clearPendingFlow, storePendingFlow, verifyEmailToken,
} from "@/lib/auth/confirmed-flow";
import { logAuthFailure } from "@/lib/auth/email-flow";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = authFlowDestination(url.searchParams.get("next"));
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  function destination(error?: string) {
    const target = new URL(next, url.origin);
    if (error) target.searchParams.set("error", error);
    const response = NextResponse.redirect(target);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }
  await clearConfirmedFlow();
  if (!tokenHash || !/^[A-Za-z0-9_-]{20,512}$/.test(tokenHash) || (type !== "invite" && type !== "recovery")) {
    await clearPendingFlow();
    // Default PKCE emails cannot safely be completed across devices.
    return destination(url.searchParams.has("code") ? "technical" : "invalid");
  }
  try {
    const supabase = await createServerSupabaseClient();
    const current = await supabase.auth.getUser();
    if (current.error && current.error.name !== "AuthSessionMissingError") {
      logAuthFailure("confirm_current_session", current.error);
      return destination("technical");
    }
    if (current.data.user) {
      // Resumed by continueEmailFlow after an explicit sign-out, never via this route.
      await storePendingFlow({ tokenHash, type, next });
      return destination("session_conflict");
    }
    await clearPendingFlow();
    const error = await verifyEmailToken(supabase, { tokenHash, type, next });
    return destination(error ?? undefined);
  } catch {
    logAuthFailure("confirm_token");
    return destination("technical");
  }
}
