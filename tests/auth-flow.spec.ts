import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import type { Database } from "@/types/database";

const owner = {
  displayName: "Owner de Validação",
  email: "owner.sprint12@example.test",
  password: "Sprint12-local-password!",
  workspaceName: "Workspace de Validação",
};

function requireTestEnvironment(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Variável obrigatória ausente para os testes: ${name}`);
  }

  return value;
}

function createTestAdminClient(): SupabaseClient<Database> {
  return createClient<Database>(
    requireTestEnvironment("NEXT_PUBLIC_SUPABASE_URL"),
    requireTestEnvironment("SUPABASE_ADMIN_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
}

test.describe.serial("local authentication flow", () => {
  test("redirects an unauthenticated private route", async ({ page }) => {
    await page.goto("/prioridades");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Entrar no ImobFlux" })).toBeVisible();
  });

  test("does not expose the private authorization schema through PostgREST", async ({
    request,
  }) => {
    const response = await request.get(
      `${requireTestEnvironment("NEXT_PUBLIC_SUPABASE_URL")}/rest/v1/app_users?select=id&limit=1`,
      {
        headers: {
          Accept: "application/json",
          "Accept-Profile": "private",
          apikey: requireTestEnvironment("NEXT_PUBLIC_SUPABASE_CLIENT_KEY"),
        },
      },
    );

    expect(response.status()).toBe(406);
    await expect(response.json()).resolves.toMatchObject({ code: "PGRST106" });
  });

  test("rejects invalid credentials without opening a session", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-mail").fill("invalid@example.test");
    await page.getByLabel("Senha").fill("invalid-password");
    await page.getByRole("button", { name: "Entrar" }).click();

    await expect(page.getByText("E-mail ou senha inválidos.")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("rejects an invalid bootstrap token", async ({ page }) => {
    await page.goto("/setup");
    await page.getByLabel("Nome do responsável").fill(owner.displayName);
    await page.getByLabel("Nome do workspace").fill(owner.workspaceName);
    await page.getByLabel("E-mail").fill(owner.email);
    await page.getByLabel("Senha").fill(owner.password);
    await page.getByLabel("Token de configuração").fill("invalid-token");
    await page.getByRole("button", { name: "Criar workspace" }).click();

    await expect(
      page.getByText("Não foi possível validar a configuração inicial."),
    ).toBeVisible();
  });

  test("creates the first OWNER and workspace through the controlled bootstrap", async ({ page }) => {
    await page.goto("/setup");
    await page.getByLabel("Nome do responsável").fill(owner.displayName);
    await page.getByLabel("Nome do workspace").fill(owner.workspaceName);
    await page.getByLabel("E-mail").fill(owner.email);
    await page.getByLabel("Senha").fill(owner.password);
    await page
      .getByLabel("Token de configuração")
      .fill(requireTestEnvironment("IMOBFLUX_BOOTSTRAP_TOKEN"));
    await page.getByRole("button", { name: "Criar workspace" }).click();

    await expect(page).toHaveURL(/\/prioridades$/);
    await expect(page.getByRole("heading", { name: "Prioridades" })).toBeVisible();

    const admin = createTestAdminClient();
    const { data: workspace, error } = await admin
      .from("workspaces")
      .select("timezone")
      .single();

    expect(error).toBeNull();
    expect(workspace?.timezone).toBe("America/Maceio");
  });

  test("closes the setup page after the first workspace", async ({ page }) => {
    await page.goto("/setup");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("keeps a valid session across navigation and reload", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-mail").fill(owner.email);
    await page.getByLabel("Senha").fill(owner.password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/prioridades$/);

    await page.reload();
    await expect(page).toHaveURL(/\/prioridades$/);
    await page.goto("/configuracoes");
    await expect(page.getByRole("heading", { name: "Configurações" })).toBeVisible();
  });

  test("logs out only the current browser session", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-mail").fill(owner.email);
    await page.getByLabel("Senha").fill(owner.password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.getByRole("button", { name: "Sair" }).click();

    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/prioridades");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("rejects and clears a session without app_users", async ({ page, context }) => {
    const admin = createTestAdminClient();
    const email = "auth-only.sprint12@example.test";
    const password = "Auth-only-local-password!";
    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      password,
    });

    expect(error).toBeNull();
    expect(data.user).not.toBeNull();

    await page.goto("/login");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha").fill(password);
    await page.getByRole("button", { name: "Entrar" }).click();

    await expect(
      page.getByText("Esta conta não possui acesso ativo ao ImobFlux."),
    ).toBeVisible();
    expect((await context.cookies()).filter((cookie) => cookie.name.includes("auth-token"))).toHaveLength(0);

    await admin.auth.admin.deleteUser(data.user!.id);
  });

  test("rejects and clears an app_user without active membership", async ({ page, context }) => {
    const admin = createTestAdminClient();
    const email = "without-membership.sprint12@example.test";
    const password = "No-membership-local-password!";
    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      password,
    });

    expect(error).toBeNull();
    expect(data.user).not.toBeNull();

    const { error: appUserError } = await admin.from("app_users").insert({
      auth_user_id: data.user!.id,
      display_name: "Sem membership",
      status: "active",
    });

    expect(appUserError).toBeNull();

    await page.goto("/login");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha").fill(password);
    await page.getByRole("button", { name: "Entrar" }).click();

    await expect(
      page.getByText("Esta conta não possui acesso ativo ao ImobFlux."),
    ).toBeVisible();
    expect((await context.cookies()).filter((cookie) => cookie.name.includes("auth-token"))).toHaveLength(0);

    await admin.auth.admin.deleteUser(data.user!.id);
  });

  test("rejects and clears an active ATTENDANT in the individual version", async ({
    page,
    context,
  }) => {
    const admin = createTestAdminClient();
    const email = "attendant.sprint13@example.test";
    const password = "Attendant-local-password!";
    const { data: authData, error: authError } =
      await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        password,
      });

    expect(authError).toBeNull();
    expect(authData.user).not.toBeNull();

    const { data: workspace, error: workspaceError } = await admin
      .from("workspaces")
      .select("id")
      .single();
    const { data: ownerMember, error: ownerMemberError } = await admin
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", workspace!.id)
      .eq("role", "owner")
      .eq("status", "active")
      .single();

    expect(workspaceError).toBeNull();
    expect(ownerMemberError).toBeNull();

    const { data: appUser, error: appUserError } = await admin
      .from("app_users")
      .insert({
        auth_user_id: authData.user!.id,
        display_name: "Atendente sem acesso individual",
        status: "active",
      })
      .select("id")
      .single();

    expect(appUserError).toBeNull();

    const membershipTimestamp = new Date(Date.now() + 60_000).toISOString();
    const { error: membershipError } = await admin
      .from("workspace_members")
      .insert({
        activated_at: membershipTimestamp,
        invited_at: membershipTimestamp,
        invited_by_member_id: ownerMember!.id,
        invited_email_normalized: email,
        role: "attendant",
        status: "active",
        user_id: appUser!.id,
        workspace_id: workspace!.id,
      });

    expect(membershipError).toBeNull();

    await page.goto("/login");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha").fill(password);
    await page.getByRole("button", { name: "Entrar" }).click();

    await expect(
      page.getByText("Esta conta não possui acesso ativo ao ImobFlux."),
    ).toBeVisible();
    expect(
      (await context.cookies()).filter((cookie) =>
        cookie.name.includes("auth-token"),
      ),
    ).toHaveLength(0);

    await admin.auth.admin.deleteUser(authData.user!.id);
  });

  test("shows the Contacts route and creates the first contact", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-mail").fill(owner.email);
    await page.getByLabel("Senha").fill(owner.password);
    await page.getByRole("button", { name: "Entrar" }).click();

    await page.getByRole("link", { name: "Contatos" }).click();
    await expect(page).toHaveURL(/\/contatos$/);
    await expect(page.getByRole("heading", { name: "Contatos" })).toBeVisible();
    await expect(page.getByText("Nenhum contato cadastrado")).toBeVisible();

    await page.getByRole("button", { name: "Novo contato" }).first().click();
    const createDialog = page.getByRole("dialog", { name: "Novo contato" });
    await createDialog.getByRole("textbox", { name: "Nome" }).fill("Contato Playwright");
    await createDialog.getByLabel("Classificação").selectOption("lead");
    await createDialog.getByLabel("Telefone principal").fill("(82) 99999-1234");
    await createDialog.getByRole("button", { name: "Cadastrar contato" }).click();

    await expect(
      page.getByRole("status").filter({ hasText: "Contato cadastrado com sucesso." }),
    ).toBeVisible();
    const table = page.getByRole("table");
    await expect(table.getByText("Contato Playwright")).toBeVisible();
    await expect(table.getByText("(82) 99999-1234")).toBeVisible();
  });

  test("filters contacts by name and normalized phone", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-mail").fill(owner.email);
    await page.getByLabel("Senha").fill(owner.password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/prioridades$/);
    await page.goto("/contatos");
    const table = page.getByRole("table");

    await page.getByLabel("Buscar por nome ou telefone").fill("Playwright");
    await page.getByRole("button", { name: "Aplicar filtros" }).click();
    await expect(table.getByText("Contato Playwright")).toBeVisible();

    await page.getByLabel("Buscar por nome ou telefone").fill("+55 (82) 99999-1234");
    await page.getByRole("button", { name: "Aplicar filtros" }).click();
    await expect(table.getByText("Contato Playwright")).toBeVisible();
  });

  test("edits the supported contact and preserves its single phone", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-mail").fill(owner.email);
    await page.getByLabel("Senha").fill(owner.password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/prioridades$/);
    await page.goto("/contatos");
    const table = page.getByRole("table");

    await table.getByRole("button", { name: "Editar Contato Playwright" }).click();
    const editDialog = page.getByRole("dialog", { name: "Editar contato" });
    await editDialog.getByRole("textbox", { name: "Nome" }).fill("Contato Playwright Atualizado");
    await editDialog.getByLabel("Classificação").selectOption("client");
    await editDialog.getByLabel("Telefone principal").fill("(82) 98888-1234");
    await editDialog.getByRole("button", { name: "Salvar alterações" }).click();

    await expect(
      page.getByRole("status").filter({ hasText: "Contato atualizado com sucesso." }),
    ).toBeVisible();
    await expect(table.getByText("Contato Playwright Atualizado")).toBeVisible();
    await expect(table.getByText("(82) 98888-1234")).toBeVisible();
    await expect(table.getByText("Cliente")).toBeVisible();
  });

  test("inactivates, reactivates, archives, and restores a contact", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-mail").fill(owner.email);
    await page.getByLabel("Senha").fill(owner.password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/prioridades$/);
    await page.goto("/contatos");
    const table = page.getByRole("table");

    await table.getByRole("button", { name: "Inativar" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Contato inativado." }),
    ).toBeVisible();
    await expect(table.getByText("Inativo")).toBeVisible();

    await table.getByRole("button", { name: "Reativar" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Contato reativado." }),
    ).toBeVisible();

    await table.getByRole("button", { name: "Arquivar" }).click();
    await expect(page.getByRole("heading", { name: "Arquivar contato?" })).toBeVisible();
    await page.getByRole("button", { name: "Arquivar contato" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Contato arquivado." }),
    ).toBeVisible();
    await expect(table.getByText("Contato Playwright Atualizado")).not.toBeVisible();

    await page.getByLabel("Filtrar por arquivamento").selectOption("true");
    await page.getByRole("button", { name: "Aplicar filtros" }).click();
    await expect(table.getByText("Contato Playwright Atualizado")).toBeVisible();
    await table.getByRole("button", { name: "Restaurar" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Contato restaurado." }),
    ).toBeVisible();
  });

  test("keeps the Contacts interface usable at tablet width", async ({ page }) => {
    await page.setViewportSize({ height: 900, width: 768 });
    await page.goto("/login");
    await page.getByLabel("E-mail").fill(owner.email);
    await page.getByLabel("Senha").fill(owner.password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/prioridades$/);
    await page.goto("/contatos");

    await expect(page.getByRole("heading", { name: "Contatos" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Novo contato" })).toBeVisible();
  });
});
