"use server";

import { redirect } from "next/navigation";
import { assertTrustedServerActionOrigin } from "@/lib/auth/security";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function continueRecoveryAction() {
  await assertTrustedServerActionOrigin();
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/auth/confirm?resume=1");
}
