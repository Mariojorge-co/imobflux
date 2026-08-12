import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const destination = new URL("/convite", url.origin);

  if (!tokenHash || type !== "invite") {
    destination.searchParams.set("error", "invalid");
    return NextResponse.redirect(destination);
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });

  if (error) {
    destination.searchParams.set(
      "error",
      error.code === "otp_expired" ? "expired" : "invalid",
    );
  }

  return NextResponse.redirect(destination);
}
