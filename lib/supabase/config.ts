const missingConfigurationMessage =
  "A configuração local do Supabase está incompleta.";

export function getPublicSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const clientKey = process.env.NEXT_PUBLIC_SUPABASE_CLIENT_KEY;

  if (!url || !clientKey) {
    throw new Error(missingConfigurationMessage);
  }

  return { clientKey, url };
}
