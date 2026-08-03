"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getPublicSupabaseConfig } from "@/lib/supabase/config";
import type { Database } from "@/types/database";

export function createBrowserSupabaseClient() {
  const { clientKey, url } = getPublicSupabaseConfig();

  return createBrowserClient<Database>(url, clientKey);
}
