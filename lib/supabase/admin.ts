import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getPublicSupabaseConfig } from "@/lib/supabase/config";
import type { Database } from "@/types/database";

export function createAdminSupabaseClient() {
  const { url } = getPublicSupabaseConfig();
  const adminKey = process.env.SUPABASE_ADMIN_KEY;

  if (!adminKey) {
    throw new Error("A configuração administrativa do Supabase está ausente.");
  }

  return createClient<Database>(url, adminKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
