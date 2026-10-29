import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// Only the dedicated, guarded config discovers these integration tests.
const ownerEmail = `owner-${Date.now()}@example.test`;
const password = "Isolated-auth-pass!9";
const staffEmail = () => `staff-${crypto.randomUUID()}@example.test`;
const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_ADMIN_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje$/);
}

async function openEmailLink(page: Page, link: string) {
  try {
    await page.goto(link);
  } catch {
    // Navigation errors must not expose one-time authentication URLs.
    throw new Error("Não foi possível abrir o link de confirmação do ambiente isolado.");
  }
}

async function invite(page: Page, email: string) {
  await page.goto("/configuracoes/equipe");
  await page.getByRole("button", { name: "Adicionar funcionário", exact: true }).click();
  await page.getByLabel("Nome", { exact: true }).fill("Funcionário isolado");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Enviar convite", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Convite criado" })).toBeVisible();
}

async function mailbox(request: APIRequestContext, email: string) {
  const response = await request.get("http://127.0.0.1:56324/api/v1/messages");
  expect(response.ok()).toBe(true);
  const body = await response.json() as { messages?: Array<{ ID: string; To?: Array<{ Address?: string }> }> };
  return (body.messages ?? []).filter((message) => message.To?.some((recipient) => recipient.Address?.toLowerCase() === email.toLowerCase()));
}

async function emailLink(request: APIRequestContext, email: string, previous: string[] = []) {
  let content = "";
  await expect.poll(async () => {
    const messages = (await mailbox(request, email)).filter((message) => !previous.includes(message.ID));
    if (!messages.length) return false;
    const response = await request.get(`http://127.0.0.1:56324/api/v1/message/${messages[0].ID}`);
    const message = await response.json() as { HTML?: string; Text?: string };
    content = message.HTML || message.Text || "";
    return /href="[^\"]*token_hash=/.test(content);
  }, { timeout: 15_000 }).toBe(true);
  const href = content.match(/href="([^\"]*token_hash=[^\"]*)"/)?.[1];
  if (!href) throw new Error("Template não forneceu confirmação server-side.");
  const url = new URL(href.replaceAll("&amp;", "&"));
  // Do not rewrite a Supabase /verify link: that would mask a bad template.
  expect(url.origin).toBe("http://localhost:3100");
  expect(url.pathname).toBe("/auth/confirm");
  expect(url.searchParams.has("token_hash")).toBe(true);
  return url.href;
}

async function accept(page: Page) {
  await expect(page.getByRole("heading", { name: "Aceitar convite", exact: true })).toBeVisible();
  await page.getByLabel("Crie sua senha", { exact: true }).fill(password);
  await page.getByLabel("Confirme sua senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Definir senha e entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje$/);
}

async function membership(email: string) {
  const { data, error } = await admin().from("workspace_members")
    .select("id, user_id, role, status, activated_at, app_users!inner(auth_user_id)")
    .eq("invited_email_normalized", email).single();
  expect(error).toBeNull();
  if (!data) throw new Error(`membership não encontrada para ${email}`);
  return data;
}

let ownerAuthId: string;
let ownerMemberId: string;
test.beforeAll(async () => {
  // Defense in depth if someone attempts to import the spec with another config.
  const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "http://invalid");
  if (process.env.IMOBFLUX_AUTH_TEST_DISPOSABLE !== "1" || url.port !== "56321" || !["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error("Banco descartável obrigatório; nenhuma operação foi executada.");
  }
  const client = admin();
  const existing = await client.from("workspaces").select("id").limit(1);
  expect(existing.error).toBeNull();
  if (existing.data?.length) throw new Error("A suíte exige banco descartável novo. Não reseta nem reutiliza bancos existentes.");
  const created = await client.auth.admin.createUser({ email: ownerEmail, password, email_confirm: true });
  expect(created.error).toBeNull();
  ownerAuthId = created.data.user!.id;
  const bootstrapped = await client.rpc("bootstrap_initial_workspace", {
    p_auth_user_id: ownerAuthId, p_display_name: "OWNER isolado", p_workspace_name: "Auth isolado", p_timezone: "America/Maceio",
  });
  expect(bootstrapped.error).toBeNull();
  const ownerMembership = await client.from("workspace_members").select("id").eq("role", "owner").single();
  expect(ownerMembership.error).toBeNull(); ownerMemberId = ownerMembership.data!.id;
});

test.afterEach(async () => {
  const member = await admin().from("workspace_members").select("id, role, status, user_id, app_users!inner(auth_user_id)").eq("id", ownerMemberId).single();
  expect(member.error).toBeNull();
  expect(member.data).toMatchObject({ id: ownerMemberId, role: "owner", status: "active", app_users: { auth_user_id: ownerAuthId } });
  const identity = await admin().auth.admin.getUserById(ownerAuthId);
  expect(identity.error).toBeNull(); expect(identity.data.user?.email).toBe(ownerEmail);
});

test("convite novo chega com template direto e ativa ATTENDANT em outro dispositivo", async ({ page, browser, request }) => {
  await login(page, ownerEmail); const email = staffEmail(); await invite(page, email);
  const before = await membership(email); expect(before).toMatchObject({ role: "attendant", status: "invited", activated_at: null });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const employee = await context.newPage(); await openEmailLink(employee, await emailLink(request, email)); await accept(employee);
    expect(await membership(email)).toMatchObject({ id: before.id, user_id: before.user_id, role: "attendant", status: "active" });
    await expect(employee.getByRole("link", { name: "Configurações", exact: true })).toHaveCount(0);
  } finally { await context.close(); }
});

test("OWNER conflitante mantém sessão e token pode ser aceito em contexto separado", async ({ page, browser, request }) => {
  await login(page, ownerEmail); const email = staffEmail(); await invite(page, email); const link = await emailLink(request, email);
  await openEmailLink(page, link); await expect(page.getByRole("heading", { name: "Outra conta está conectada" })).toBeVisible();
  await expect(page.getByLabel("Crie sua senha")).toHaveCount(0);
  expect((await membership(email))?.status).toBe("invited");
  const context = await browser.newContext();
  try { const employee = await context.newPage(); await openEmailLink(employee, link); await accept(employee); } finally { await context.close(); }
  await page.goto("/configuracoes/equipe"); await expect(page).toHaveURL(/\/configuracoes\/equipe$/);
});

test("outro ATTENDANT não aceita convite de terceiro e pode sair explicitamente para continuar", async ({ page, browser, request }) => {
  await login(page, ownerEmail); const first = staffEmail(); await invite(page, first);
  const context = await browser.newContext();
  try {
    const employee = await context.newPage(); await openEmailLink(employee, await emailLink(request, first)); await accept(employee);
    const second = staffEmail(); await invite(page, second); await openEmailLink(employee, await emailLink(request, second));
    await expect(employee.getByRole("heading", { name: "Outra conta está conectada" })).toBeVisible();
    expect((await membership(second))?.status).toBe("invited");
    await employee.getByRole("button", { name: "Sair da conta atual e continuar", exact: true }).click();
    await accept(employee); expect((await membership(second))?.status).toBe("active");
    expect((await membership(first))?.status).toBe("active");
  } finally { await context.close(); }
});

test("reenvio recupera identidade consumida sem excluir Auth nem recriar funcionário", async ({ page, browser, request }) => {
  await login(page, ownerEmail); const email = staffEmail(); await invite(page, email);
  const oldLink = await emailLink(request, email); const before = await membership(email);
  const first = await browser.newContext();
  try { const employee = await first.newPage(); await openEmailLink(employee, oldLink); await expect(employee.getByLabel("Crie sua senha")).toBeVisible(); } finally { await first.close(); }
  const previous = (await mailbox(request, email)).map((message) => message.ID);
  const row = page.getByRole("table").getByRole("row").filter({ hasText: email });
  await row.getByRole("button", { name: "Reenviar convite", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Novo acesso solicitado" })).toBeVisible();
  const next = await browser.newContext();
  try { const employee = await next.newPage(); await openEmailLink(employee, await emailLink(request, email, previous)); await accept(employee); } finally { await next.close(); }
  expect(await membership(email)).toMatchObject({ id: before.id, user_id: before.user_id, app_users: before.app_users, role: "attendant", status: "active" });
});

test("recuperação geral de convidado conduz ao aceite em vez de deixar vínculo pendente", async ({ page, browser, request }) => {
  await login(page, ownerEmail); const email = staffEmail(); await invite(page, email);
  const previous = (await mailbox(request, email)).map((message) => message.ID);
  const context = await browser.newContext();
  try {
    const employee = await context.newPage(); await employee.goto("/redefinir-senha");
    await employee.getByLabel("E-mail").fill(email); await employee.getByRole("button", { name: "Enviar instruções" }).click();
    await expect(employee.getByRole("status")).toContainText("Se houver uma conta correspondente");
    await openEmailLink(employee, await emailLink(request, email, previous)); await accept(employee);
    expect((await membership(email))?.status).toBe("active");
  } finally { await context.close(); }
});

test("botão de exibir senha alterna o campo e volta a ocultar ao enviar", async ({ page }) => {
  await page.goto("/login");
  const field = page.getByLabel("Senha", { exact: true });
  const toggle = page.getByRole("button", { name: "Mostrar caracteres", exact: true });
  await field.fill("valor-visivel-123");
  await expect(field).toHaveAttribute("type", "password");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(field).toHaveAttribute("type", "text");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  await expect(field).toHaveAttribute("type", "password");
  await toggle.click();
  await page.getByLabel("E-mail").fill("inexistente@example.test");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("status")).toBeVisible();
  await expect(page.getByLabel("Senha", { exact: true })).toHaveAttribute("type", "password");
  await expect(page.getByRole("button", { name: "Mostrar caracteres", exact: true })).toHaveAttribute("aria-pressed", "false");
});

test("link reutilizado ou inválido não oferece alteração de senha", async ({ page, browser, request }) => {
  await login(page, ownerEmail); const email = staffEmail(); await invite(page, email); const link = await emailLink(request, email);
  const context = await browser.newContext();
  try { const employee = await context.newPage(); await openEmailLink(employee, link); await accept(employee); } finally { await context.close(); }
  const replay = await browser.newContext();
  try {
    const employee = await replay.newPage(); await openEmailLink(employee, link);
    await expect(employee.getByText(/expirou ou já foi utilizado/)).toBeVisible();
    await expect(employee.getByLabel("Crie sua senha")).toHaveCount(0);
    await employee.goto("/auth/confirm?token_hash=invalid&type=invite&next=/convite");
    await expect(employee.getByText(/link é inválido/)).toBeVisible();
    await expect(employee.getByLabel("Crie sua senha")).toHaveCount(0);
  } finally { await replay.close(); }
});
