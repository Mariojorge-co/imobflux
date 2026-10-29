/* eslint-disable @typescript-eslint/no-require-imports */
import { expect, test } from "@playwright/test";
import { createHmac } from "node:crypto";
import type { ReactElement } from "react";
import { createClient } from "@supabase/supabase-js";

// In-memory Auth and domain fixtures: never connect to Supabase or load .env.
const jar = new Map<string, string>();
const cookieOptions: Record<string, unknown>[] = [];
const cookieStore = {
  get: (name: string) => jar.has(name) ? { value: jar.get(name)! } : undefined,
  set: (name: string, value: string, options: Record<string, unknown>) => { jar.set(name, value); cookieOptions.push(options); },
  delete: (name: string) => { jar.delete(name); },
};
class Redirect extends Error { constructor(readonly destination: string) { super("test_redirect"); } }
function stubModule(name: string, exports: object) {
  const path = require.resolve(name);
  require.cache[path] = { id: path, filename: path, loaded: true, exports } as never;
}
stubModule("server-only", {});
stubModule("next/headers", { cookies: async () => cookieStore, headers: async () => new Headers({ origin: "https://app.test", host: "app.test" }) });
stubModule("next/navigation", { redirect: (path: string) => { throw new Redirect(path); } });
stubModule("next/cache", { revalidatePath: () => {} });

const serverModule = require("@/lib/supabase/server");
const adminModule = require("@/lib/supabase/admin");
const emailModule = require("@/lib/supabase/email");
const dal = require("@/lib/auth/dal");
const originalServer = serverModule.createServerSupabaseClient;
const originalAdmin = adminModule.createAdminSupabaseClient;
const originalEmail = emailModule.createEmailSupabaseClient;
const originalAccess = dal.getActiveAccessForAuthUser;
const originalRequireOwner = dal.requireOwnerAccess;
const oldKey = process.env.SUPABASE_ADMIN_KEY;
const oldUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const oldPublicKey = process.env.NEXT_PUBLIC_SUPABASE_CLIENT_KEY;

const flowLib = require("@/lib/auth/confirmed-flow") as typeof import("@/lib/auth/confirmed-flow");
const { GET } = require("@/app/auth/confirm/route") as typeof import("@/app/auth/confirm/route");
const invitationActions = require("@/app/(auth)/convite/actions") as typeof import("@/app/(auth)/convite/actions");
const recoveryActions = require("@/app/(auth)/redefinir-senha/actions") as typeof import("@/app/(auth)/redefinir-senha/actions");
const teamActions = require("@/app/(app)/configuracoes/equipe/actions") as typeof import("@/app/(app)/configuracoes/equipe/actions");
const { lookupInvitationForUser } = require("@/lib/auth/invitation") as typeof import("@/lib/auth/invitation");
const InvitationPage = require("@/app/(auth)/convite/page").default;
const RecoveryPage = require("@/app/(auth)/redefinir-senha/page").default;

const staff = { id: "staff-auth", email: "staff@example.test" };
const owner = { id: "owner-auth", email: "owner@example.test" };
const token = "a".repeat(64);
let user: typeof staff | null;
let sessionId: string;
let lookupStatus: "pending" | "expired" | "not_found" | "technical";
let emailFailure: { status: number; code?: string; message?: string } | null;
let verifyFailure: { status: number; code: string } | null;
let acceptanceFailure: { message: string } | null;
let signOutFailure: { status: number } | null;
let updateFailure: { status: number } | null;
let activated: boolean;
let calls: string[];
let logs: unknown[][];
let used: Set<string>;
const originalWarn = console.warn;

const client = {
  auth: {
    getUser: async () => ({ data: { user }, error: null }),
    getClaims: async () => ({ data: { claims: { sub: user?.id, session_id: sessionId } }, error: null }),
    verifyOtp: async (input: { token_hash: string; type: string }) => {
      calls.push(`verify:${input.type}`);
      if (verifyFailure || used.has(input.token_hash)) return { data: { user: null }, error: verifyFailure ?? { status: 403, code: "otp_expired" } };
      used.add(input.token_hash); user = staff; sessionId = "staff-session";
      return { data: { user }, error: null };
    },
    updateUser: async () => { calls.push(`password:${user?.id}`); return { data: { user }, error: updateFailure }; },
    signOut: async () => { calls.push("signout"); if (!signOutFailure) user = null; return { error: signOutFailure }; },
  },
  rpc: async (name: string) => {
    calls.push(`rpc:${name}`);
    if (name === "get_pending_team_invitation") return { data: [{ auth_user_id: staff.id, email: staff.email, member_id: "staff-member" }], error: null };
    if (name === "prepare_team_invitation") return { data: { member_id: "staff-member" }, error: null };
    if (name === "accept_team_invitation") { if (!acceptanceFailure) activated = true; return { data: {}, error: acceptanceFailure }; }
    return { data: {}, error: null };
  },
};
const invitation = () => ({ id: "staff-app", workspace_members: [{ id: "staff-member", workspace_id: "workspace", invited_email_normalized: staff.email, invitation_expires_at: new Date(Date.now() + (lookupStatus === "expired" ? -60_000 : 60_000)).toISOString() }] });
const admin = {
  from: () => {
    const filters = new Map<string, unknown>();
    const query = {
      select: () => query,
      eq: (name: string, value: unknown) => { filters.set(name, value); return query; },
      limit: () => query,
      maybeSingle: async () => ({ data: lookupStatus === "not_found" || filters.get("auth_user_id") !== staff.id ? null : invitation(), error: lookupStatus === "technical" ? { message: "fixture_error" } : null }),
    };
    return query;
  },
  auth: { admin: { inviteUserByEmail: async () => { calls.push("invite"); return { data: { user: staff }, error: emailFailure }; } } },
  rpc: async () => { calls.push("bind"); return { error: null }; },
};

function passwordForm() { const form = new FormData(); form.set("password", "Test-password!9"); form.set("passwordConfirmation", "Test-password!9"); return form; }
function requestUrl(type = "invite", next = "/convite", hash = token) {
  return new Request(`https://app.test/auth/confirm?${new URLSearchParams({ token_hash: hash, type, next })}`);
}
async function confirm(type = "invite", next = "/convite") { return GET(requestUrl(type, next)); }
function hasComponent(element: ReactElement<{ children?: unknown }>, name: string): boolean {
  if (!element || typeof element !== "object") return false;
  if (typeof element.type === "function" && element.type.name === name) return true;
  const children = element.props?.children;
  return (Array.isArray(children) ? children : [children]).some((child) => child && typeof child === "object" && hasComponent(child as ReactElement<{ children?: unknown }>, name));
}

test.beforeEach(() => {
  process.env.SUPABASE_ADMIN_KEY = "unit-test-signing-key-not-a-real-credential";
  jar.clear(); cookieOptions.length = 0; user = null; sessionId = "empty-session";
  lookupStatus = "pending"; emailFailure = null; verifyFailure = null; acceptanceFailure = null; signOutFailure = null; updateFailure = null;
  activated = false; calls = []; logs = []; used = new Set();
  serverModule.createServerSupabaseClient = async () => client;
  adminModule.createAdminSupabaseClient = () => admin;
  emailModule.createEmailSupabaseClient = () => ({ auth: { resetPasswordForEmail: async () => { calls.push("email"); return { error: emailFailure }; } } });
  dal.getActiveAccessForAuthUser = async () => null;
  dal.requireOwnerAccess = async () => ({ role: "owner", authUserId: owner.id, memberId: "owner-member", workspaceId: "workspace" });
  console.warn = (...values: unknown[]) => { logs.push(values); };
});
test.afterEach(() => {
  serverModule.createServerSupabaseClient = originalServer;
  adminModule.createAdminSupabaseClient = originalAdmin;
  emailModule.createEmailSupabaseClient = originalEmail;
  dal.getActiveAccessForAuthUser = originalAccess;
  dal.requireOwnerAccess = originalRequireOwner;
  console.warn = originalWarn;
  for (const [name, value] of Object.entries({ SUPABASE_ADMIN_KEY: oldKey, NEXT_PUBLIC_SUPABASE_URL: oldUrl, NEXT_PUBLIC_SUPABASE_CLIENT_KEY: oldPublicKey })) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

test("new invitation works in a fresh device without an OWNER PKCE verifier", async () => {
  expect((await confirm()).headers.get("location")).toBe("https://app.test/convite");
  expect(user).toEqual(staff);
  expect(calls).toEqual(["verify:invite"]);
  expect(await flowLib.getConfirmedFlow(client as never, staff.id)).toMatchObject({ type: "invite", userId: staff.id, sessionId: "staff-session" });
  expect(cookieOptions.every((options) => options.httpOnly && options.sameSite === "lax")).toBe(true);
});

for (const identity of [owner, { id: "other-attendant", email: "other@example.test" }]) {
  test(`conflict ${identity.id} does not consume token or change the current identity`, async () => {
    user = identity;
    const result = await confirm();
    expect(result.headers.get("location")).toContain("error=session_conflict");
    expect(calls).toEqual([]); expect(user).toEqual(identity); expect(used.size).toBe(0);
    expect(await flowLib.readPendingFlow()).toMatchObject({ next: "/convite" });
    const page = await InvitationPage({ searchParams: Promise.resolve({ error: "session_conflict" }) });
    expect(hasComponent(page, "SessionConflict")).toBe(true);
    expect(hasComponent(page, "InvitationPasswordForm")).toBe(false);
  });
}

test("explicit logout preserves recovery destination and only then verifies token", async () => {
  user = owner;
  await confirm("recovery", "/redefinir-senha");
  expect(used.size).toBe(0);
  // Cookies must be set by the action itself: a redirect to a Route Handler is fetched server-side.
  await expect(invitationActions.continueInvitationAction()).rejects.toMatchObject({ destination: "/redefinir-senha" });
  expect(calls).toEqual(["signout", "verify:recovery"]);
  expect(jar.has("imobflux_pending_auth_flow")).toBe(false);
  expect(await flowLib.getConfirmedFlow(client as never, staff.id)).toMatchObject({ type: "recovery", next: "/redefinir-senha", sessionId: "staff-session" });
  const resumed = await GET(new Request("https://app.test/auth/confirm?resume=1&next=/convite"));
  expect(resumed.headers.get("location")).toBe("https://app.test/convite?error=invalid");
});

test("failed logout never consumes token", async () => {
  user = owner; await confirm("recovery", "/redefinir-senha"); signOutFailure = { status: 500 };
  await expect(invitationActions.continueInvitationAction()).rejects.toMatchObject({ destination: "/redefinir-senha?error=technical" });
  expect(user).toEqual(owner); expect(used.size).toBe(0);
});

test("forged pending cookie cannot log out OWNER", async () => {
  user = owner; jar.set("imobflux_pending_auth_flow", "forged");
  await expect(invitationActions.continueInvitationAction()).rejects.toMatchObject({ destination: "/convite?error=invalid" });
  expect(calls).toEqual([]); expect(user).toEqual(owner);
});

test("reused link rejects and removes previous confirmation context", async () => {
  await confirm(); user = null;
  const result = await confirm();
  expect(result.headers.get("location")).toContain("error=expired");
  expect(jar.has("imobflux_confirmed_auth_flow")).toBe(false);
});

for (const [name, failure, expected] of [
  ["expired", { status: 403, code: "otp_expired" }, "expired"],
  ["invalid", { status: 403, code: "invalid_token" }, "invalid"],
  ["429", { status: 429, code: "over_email_send_rate_limit" }, "technical"],
  ["network", { status: 0, code: "fetch_failed" }, "technical"],
] as const) {
  test(`confirmation distinguishes ${name}`, async () => {
    verifyFailure = failure;
    expect((await confirm()).headers.get("location")).toContain(`error=${expected}`);
    expect(jar.has("imobflux_confirmed_auth_flow")).toBe(false);
  });
}

test("untrusted redirect cannot leave allowed routes", async () => {
  expect((await confirm("invite", "https://attacker.test")).headers.get("location")).toBe("https://app.test/convite");
});

test("default legacy PKCE callback fails safely rather than using OWNER session", async () => {
  user = owner;
  const result = await GET(new Request("https://app.test/auth/confirm?code=fixture&next=/redefinir-senha"));
  expect(result.headers.get("location")).toContain("error=technical"); expect(calls).toEqual([]); expect(user).toEqual(owner);
});

test("ordinary OWNER login does not authorize a password reset or invitation acceptance", async () => {
  user = owner;
  expect((await recoveryActions.updatePasswordAction({ message: "", status: "idle" }, passwordForm())).status).toBe("error");
  expect((await invitationActions.acceptInvitationAction({ message: "", status: "idle" }, passwordForm())).status).toBe("error");
  expect(calls).toEqual([]); expect(user).toEqual(owner);
});

test("signed recovery context cannot be forged, reused by another user or another session", async () => {
  await confirm("recovery", "/redefinir-senha");
  const signed = jar.get("imobflux_confirmed_auth_flow")!;
  jar.set("imobflux_confirmed_auth_flow", signed.replace(/^./, "z"));
  expect(await flowLib.getConfirmedFlow(client as never, staff.id)).toBeNull();
  jar.set("imobflux_confirmed_auth_flow", signed);
  user = owner; expect(await flowLib.getConfirmedFlow(client as never, owner.id)).toBeNull();
  user = staff; sessionId = "another-session"; expect(await flowLib.getConfirmedFlow(client as never, staff.id)).toBeNull();
});

test("confirmed context expires independently of an existing authenticated session", async () => {
  await confirm("recovery");
  const original = Date.now; Date.now = () => original() + 901_000;
  try { expect(await flowLib.getConfirmedFlow(client as never, staff.id)).toBeNull(); } finally { Date.now = original; }
});

test("pending invitation defines password before activation and keeps OWNER identity separate", async () => {
  await confirm();
  await expect(invitationActions.acceptInvitationAction({ message: "", status: "idle" }, passwordForm())).rejects.toMatchObject({ destination: "/hoje" });
  expect(calls).toEqual(["verify:invite", "password:staff-auth", "rpc:accept_team_invitation"]);
  expect(activated).toBe(true); expect(jar.has("imobflux_confirmed_auth_flow")).toBe(false);
  expect(owner).toEqual({ id: "owner-auth", email: "owner@example.test" });
});

test("failed password definition never activates membership", async () => {
  await confirm(); updateFailure = { status: 500 };
  expect((await invitationActions.acceptInvitationAction({ message: "", status: "idle" }, passwordForm())).status).toBe("error");
  expect(activated).toBe(false); expect(calls).not.toContain("rpc:accept_team_invitation");
});

test("failed activation retains password-defined phase and retry does not change password twice", async () => {
  await confirm(); acceptanceFailure = { message: "fixture_rpc_error" };
  expect((await invitationActions.acceptInvitationAction({ message: "", status: "idle" }, passwordForm())).message).toContain("senha foi definida");
  expect(await flowLib.getConfirmedFlow(client as never, staff.id)).toMatchObject({ phase: "password_defined" });
  const page = await InvitationPage({ searchParams: Promise.resolve({}) });
  expect(hasComponent(page, "InvitationPasswordForm")).toBe(true);
  acceptanceFailure = null;
  await expect(invitationActions.acceptInvitationAction({ message: "", status: "idle" }, new FormData())).rejects.toMatchObject({ destination: "/hoje" });
  expect(calls.filter((call) => call.startsWith("password:"))).toHaveLength(1);
  expect(activated).toBe(true);
});

test("lost RPC response reconciles only the expected attendant membership", async () => {
  await confirm(); acceptanceFailure = { message: "lost_response" };
  dal.getActiveAccessForAuthUser = async () => ({ memberId: "staff-member", workspaceId: "workspace", role: "attendant" });
  await expect(invitationActions.acceptInvitationAction({ message: "", status: "idle" }, passwordForm())).rejects.toMatchObject({ destination: "/hoje" });
});

test("ambiguous activation can reconcile on a later retry without changing password or calling RPC again", async () => {
  await confirm(); acceptanceFailure = { message: "lost_response" };
  expect((await invitationActions.acceptInvitationAction({ message: "", status: "idle" }, passwordForm())).status).toBe("error");
  lookupStatus = "not_found";
  dal.getActiveAccessForAuthUser = async () => ({ memberId: "staff-member", workspaceId: "workspace", role: "attendant" });
  const beforeRetry = [...calls];
  await expect(InvitationPage({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({ destination: "/hoje" });
  await expect(invitationActions.acceptInvitationAction({ message: "", status: "idle" }, new FormData())).rejects.toMatchObject({ destination: "/hoje" });
  expect(calls).toEqual(beforeRetry);
});

test("reconciliation refuses a different membership or workspace", async () => {
  await confirm(); acceptanceFailure = { message: "lost_response" };
  await invitationActions.acceptInvitationAction({ message: "", status: "idle" }, passwordForm());
  lookupStatus = "not_found";
  dal.getActiveAccessForAuthUser = async () => ({ memberId: "other-member", workspaceId: "other-workspace", role: "attendant" });
  expect((await invitationActions.acceptInvitationAction({ message: "", status: "idle" }, new FormData())).status).toBe("error");
});

test("generic recovery of invited employee routes to acceptance, never leaves it silently invited after password reset", async () => {
  await confirm("recovery", "/redefinir-senha");
  await expect(RecoveryPage({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({ destination: "/convite" });
  await expect(recoveryActions.updatePasswordAction({ message: "", status: "idle" }, passwordForm())).rejects.toMatchObject({ destination: "/convite" });
  expect(calls).toEqual(["verify:recovery"]);
  await expect(invitationActions.acceptInvitationAction({ message: "", status: "idle" }, passwordForm())).rejects.toMatchObject({ destination: "/hoje" });
  expect(activated).toBe(true);
});

for (const status of ["expired", "technical"] as const) {
  test(`membership ${status} prevents password change and activation`, async () => {
    await confirm(); lookupStatus = status;
    const result = await invitationActions.acceptInvitationAction({ message: "", status: "idle" }, passwordForm());
    expect(result.status).toBe("error"); expect(calls).toEqual(["verify:invite"]); expect(activated).toBe(false);
    expect((await lookupInvitationForUser(staff.id, staff.email)).status).toBe(status);
  });
}

test("active account recovery changes only verified identity, clears context and signs out locally", async () => {
  await confirm("recovery", "/redefinir-senha"); lookupStatus = "not_found";
  await expect(recoveryActions.updatePasswordAction({ message: "", status: "idle" }, passwordForm())).rejects.toMatchObject({ destination: "/login?reason=password_updated" });
  expect(calls).toEqual(["verify:recovery", "password:staff-auth", "signout"]);
  expect(jar.has("imobflux_confirmed_auth_flow")).toBe(false);
});

test("error query never exposes password form despite an existing valid session/context", async () => {
  await confirm("recovery", "/redefinir-senha");
  for (const error of ["invalid", "expired", "technical"]) {
    const page = await RecoveryPage({ searchParams: Promise.resolve({ error }) });
    expect(hasComponent(page, "PasswordResetForm")).toBe(false);
    expect(hasComponent(await InvitationPage({ searchParams: Promise.resolve({ error }) }), "InvitationPasswordForm")).toBe(false);
  }
});

test("public 429 response does not enumerate accounts and logs contain only sanitized fields", async () => {
  const form = new FormData(); form.set("email", staff.email);
  const success = await recoveryActions.requestPasswordResetAction({ message: "", status: "idle" }, form);
  emailFailure = { status: 429, code: "over_email_send_rate_limit", message: "secret-token recipient credential fixture" };
  const failure = await recoveryActions.requestPasswordResetAction({ message: "", status: "idle" }, form);
  expect(failure).toEqual(success);
  expect(logs).toEqual([["[auth-flow]", { operation: "password_recovery_send", status: 429, category: "rate_limit" }]]);
  expect(JSON.stringify(logs)).not.toContain(staff.email);
  expect(JSON.stringify(logs)).not.toContain("secret-token");
});

test("resend uses stateless sender and only renews membership after successful request", async () => {
  await teamActions.resendInviteAction("staff-member");
  expect(calls).toEqual(["rpc:get_pending_team_invitation", "email", "rpc:mark_team_invitation_resent"]);
  calls = []; emailFailure = { status: 429 };
  const result = await teamActions.resendInviteAction("staff-member");
  expect(result.status).toBe("error"); expect(result.message).toContain("limitou");
  expect(calls).toEqual(["rpc:get_pending_team_invitation", "email"]);
});

test("new invitation binds existing returned Auth identity without deleting users", async () => {
  const form = new FormData(); form.set("displayName", "Test Staff"); form.set("email", staff.email);
  const result = await teamActions.inviteMemberAction(form);
  expect(result.status).toBe("success");
  expect(calls).toEqual(["rpc:prepare_team_invitation", "invite", "bind"]);
});

test("email client is public, stateless and not PKCE even when caller has a session", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:56321";
  process.env.NEXT_PUBLIC_SUPABASE_CLIENT_KEY = "unit-public-fixture";
  const sender = originalEmail();
  expect(sender.auth).toMatchObject({ persistSession: false, autoRefreshToken: false, flowType: "implicit" });
  await sender.auth.stopAutoRefresh();
});

test("signature is domain-separated: pending token cannot be used as confirmed context", async () => {
  const payload = Buffer.from(JSON.stringify({ userId: staff.id, sessionId: "staff-session", type: "recovery", next: "/convite", phase: "verified", expiresAt: Date.now() + 60_000 })).toString("base64url");
  const signature = createHmac("sha256", process.env.SUPABASE_ADMIN_KEY!).update(`imobflux:pending:v1:${payload}`).digest("base64url");
  user = staff; sessionId = "staff-session";
  jar.set("imobflux_confirmed_auth_flow", `${payload}.${signature}`);
  expect(await flowLib.getConfirmedFlow(client as never, staff.id)).toBeNull();
});

test("SDK recovery request omits PKCE challenge and fresh device can verify token_hash without browser storage", async () => {
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  const accessToken = [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({ sub: staff.id, session_id: "sdk-staff-session", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url"),
    "synthetic-signature",
  ].join(".");
  const transport: typeof fetch = async (input, init) => {
    const path = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).pathname;
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    requests.push({ path, body });
    if (path.endsWith("/recover")) return Response.json({});
    if (path.endsWith("/verify")) return Response.json({ access_token: accessToken, refresh_token: "synthetic-refresh", token_type: "bearer", expires_in: 3600, user: staff });
    if (path.endsWith("/user")) return Response.json(staff);
    throw new Error("Unexpected network request in isolated SDK fixture");
  };
  const options = { global: { fetch: transport }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: "implicit" as const } };
  const sender = createClient("http://127.0.0.1:56321", "fixture-public", options);
  expect((await sender.auth.resetPasswordForEmail(staff.email, { redirectTo: "https://app.test/auth/confirm?next=/convite" })).error).toBeNull();
  // auth-js sends explicit null in implicit mode, never a verifier challenge.
  expect(requests[0].body.code_challenge).toBeNull();
  const otherDevice = createClient("http://127.0.0.1:56321", "fixture-public", options);
  const verified = await otherDevice.auth.verifyOtp({ token_hash: token, type: "recovery" });
  expect(verified.error).toBeNull(); expect(verified.data.user?.id).toBe(staff.id);
  expect(requests[1].body).toMatchObject({ token_hash: token, type: "recovery" });
  expect(requests[1].body.code_verifier).toBeUndefined();
  await flowLib.storeConfirmedFlow(otherDevice as never, staff.id, "recovery", "/convite");
  expect(await flowLib.getConfirmedFlow(otherDevice as never, staff.id)).toMatchObject({ sessionId: "sdk-staff-session" });
});

test("unexpected invite sender exception is sanitized and never binds a fabricated identity", async () => {
  const original = admin.auth.admin.inviteUserByEmail;
  admin.auth.admin.inviteUserByEmail = async () => { throw new Error("private-email token password"); };
  try {
    const form = new FormData(); form.set("displayName", "Test Staff"); form.set("email", staff.email);
    expect((await teamActions.inviteMemberAction(form)).status).toBe("warning");
    expect(calls).toEqual(["rpc:prepare_team_invitation"]);
    expect(logs).toEqual([["[auth-flow]", { operation: "team_invitation_send", status: 0, category: "technical" }]]);
  } finally { admin.auth.admin.inviteUserByEmail = original; }
});

test("team resend refuses unauthorized caller before reading invitation or sending email", async () => {
  dal.requireOwnerAccess = async () => { throw new Error("forbidden"); };
  expect((await teamActions.resendInviteAction("staff-member")).status).toBe("error");
  expect(calls).toEqual([]);
});
