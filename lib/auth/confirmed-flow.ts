import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { classifyAuthFailure, logAuthFailure, type AuthFlowError } from "./email-flow";

export type AuthFlowDestination = "/convite" | "/redefinir-senha";
export type AuthFlowType = "invite" | "recovery";
export type ConfirmedFlow = {
  userId: string; sessionId: string; type: AuthFlowType; next: AuthFlowDestination;
  phase: "verified" | "password_defined"; expiresAt: number;
  memberId?: string;
  workspaceId?: string;
};
type PendingFlow = { tokenHash: string; type: AuthFlowType; next: AuthFlowDestination; expiresAt: number };
const FLOW_COOKIE = "imobflux_confirmed_auth_flow";
const PENDING_COOKIE = "imobflux_pending_auth_flow";
const options = { httpOnly: true, path: "/", sameSite: "lax" as const, secure: process.env.NODE_ENV === "production" };

export function authFlowDestination(value: unknown): AuthFlowDestination {
  return value === "/redefinir-senha" ? value : "/convite";
}

function signature(payload: string, purpose: string) {
  const key = process.env.SUPABASE_ADMIN_KEY;
  if (!key) throw new Error("auth_flow_configuration_missing");
  return createHmac("sha256", key).update(`imobflux:${purpose}:v1:${payload}`).digest();
}

function encode(value: object, purpose: string) {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${signature(payload, purpose).toString("base64url")}`;
}

function decode(value: string | undefined, purpose: string): Record<string, unknown> | null {
  if (!value || value.length > 4096) return null;
  try {
    const parts = value.split(".");
    if (parts.length !== 2) return null;
    const expected = signature(parts[0], purpose);
    const supplied = Buffer.from(parts[1], "base64url");
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
    const data = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (!data || typeof data.expiresAt !== "number" || data.expiresAt <= Date.now()) return null;
    if (data.type !== "invite" && data.type !== "recovery") return null;
    if (data.next !== "/convite" && data.next !== "/redefinir-senha") return null;
    return data;
  } catch { return null; }
}

export async function clearConfirmedFlow() { (await cookies()).delete(FLOW_COOKIE); }
export async function storePendingFlow(input: Omit<PendingFlow, "expiresAt">) {
  (await cookies()).set(PENDING_COOKIE, encode({ ...input, expiresAt: Date.now() + 600_000 }, "pending"), { ...options, maxAge: 600 });
}
export async function readPendingFlow(): Promise<PendingFlow | null> {
  const value = decode((await cookies()).get(PENDING_COOKIE)?.value, "pending");
  if (!value || typeof value.tokenHash !== "string" || !/^[A-Za-z0-9_-]{20,512}$/.test(value.tokenHash)) return null;
  return value as PendingFlow;
}
export async function clearPendingFlow() {
  const store = await cookies();
  store.delete(PENDING_COOKIE);
  store.delete("imobflux_pending_auth_token");
  store.delete("imobflux_pending_auth_type");
}

async function verifiedSessionId(client: SupabaseClient<Database>, userId: string) {
  const { data, error } = await client.auth.getClaims();
  if (error && classifyAuthFailure(error) === "technical") throw new Error("auth_flow_session_unavailable");
  const claims = data?.claims;
  return !error && claims?.sub === userId && typeof claims.session_id === "string" ? claims.session_id : null;
}
export async function storeConfirmedFlow(client: SupabaseClient<Database>, userId: string, type: AuthFlowType, next: AuthFlowDestination) {
  const sessionId = await verifiedSessionId(client, userId);
  if (!sessionId) throw new Error("auth_flow_session_missing");
  const flow: ConfirmedFlow = { userId, sessionId, type, next, phase: "verified", expiresAt: Date.now() + 900_000 };
  (await cookies()).set(FLOW_COOKIE, encode(flow, "confirmed"), { ...options, maxAge: 900 });
}
// Consumes the one-time token; callers must have ruled out a conflicting session first.
export async function verifyEmailToken(client: SupabaseClient<Database>, flow: Omit<PendingFlow, "expiresAt">): Promise<AuthFlowError | null> {
  try {
    const { data, error } = await client.auth.verifyOtp({ token_hash: flow.tokenHash, type: flow.type });
    if (error || !data.user) {
      logAuthFailure("confirm_token", error);
      return error ? classifyAuthFailure(error) : "technical";
    }
    await storeConfirmedFlow(client, data.user.id, flow.type, flow.next);
    return null;
  } catch {
    logAuthFailure("confirm_token");
    return "technical";
  }
}
export async function getConfirmedFlow(client: SupabaseClient<Database>, userId: string): Promise<ConfirmedFlow | null> {
  const value = decode((await cookies()).get(FLOW_COOKIE)?.value, "confirmed");
  if (!value || value.userId !== userId || typeof value.sessionId !== "string") return null;
  if (value.phase !== "verified" && value.phase !== "password_defined") return null;
  const sessionId = await verifiedSessionId(client, userId);
  return sessionId === value.sessionId ? value as ConfirmedFlow : null;
}
export async function markFlowPasswordDefined(flow: ConfirmedFlow, membership: { memberId: string; workspaceId: string }) {
  (await cookies()).set(FLOW_COOKIE, encode({ ...flow, ...membership, phase: "password_defined", next: "/convite" }, "confirmed"), {
    ...options, maxAge: Math.max(0, Math.floor((flow.expiresAt - Date.now()) / 1000)),
  });
}
