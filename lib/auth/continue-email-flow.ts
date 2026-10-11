import "server-only";
import { redirect } from "next/navigation";
import { assertTrustedServerActionOrigin } from "./security";
import { clearConfirmedFlow, clearPendingFlow, readPendingFlow, verifyEmailToken } from "./confirmed-flow";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { logAuthFailure } from "./email-flow";

export async function continueEmailFlow() {
  await assertTrustedServerActionOrigin();
  const pending = await readPendingFlow();
  if (!pending) redirect("/convite?error=invalid");
  const supabase = await createServerSupabaseClient();
  let failed = false;
  try {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) { logAuthFailure("continue_sign_out", error); failed = true; }
  } catch { logAuthFailure("continue_sign_out"); failed = true; }
  if (failed) redirect(`${pending.next}?error=technical`);
  await clearConfirmedFlow();
  await clearPendingFlow();
  // Verify here rather than redirecting to /auth/confirm: Next resolves an action
  // redirect through an internal server fetch, so a Route Handler would consume the
  // token while its session and confirmed-flow cookies never reach the browser.
  const error = await verifyEmailToken(supabase, pending);
  redirect(error ? `${pending.next}?error=${error}` : pending.next);
}
