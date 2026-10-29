import "server-only";

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/** Resposta JSON sem cache (nunca guardar o que tem a ver com aparelhos). */
export function pushJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Porta de entrada das rotas de aviso: mesma origem (um site de terceiros não dispara nada) e pessoa logada.
 * Devolve o cliente do Supabase DA PESSOA (a RLS limita tudo às assinaturas dela) ou a resposta de erro.
 */
export async function pushRouteContext(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return { error: pushJson({ error: "Origem não permitida." }, 403) as NextResponse, supabase: null };
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: pushJson({ error: "Entre na sua conta." }, 401) as NextResponse, supabase: null };
  return { error: null, supabase };
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
