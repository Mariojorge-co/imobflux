import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getPublicSupabaseConfig } from "./config";

// Email requests must not inherit the OWNER's SSR cookies or PKCE verifier.
export function createEmailSupabaseClient() {
  const { url, clientKey } = getPublicSupabaseConfig();
  return createClient(url, clientKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false, flowType: "implicit" },
  });
}
