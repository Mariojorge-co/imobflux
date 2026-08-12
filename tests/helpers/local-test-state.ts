import { execSync } from "child_process";
import { expect, type Page } from "@playwright/test";

export const demoOwner = {
  email: "corretor@imobflux.local",
  password: "Sprint22-demo-pass!",
};

export const demoAttendant = {
  email: "atendente@imobflux.local",
  password: "Equipe-demo-pass!",
};

function localCommandEnvironment() {
  const inheritedPath = process.env.PATH || process.env.Path || "";

  return {
    ...process.env,
    PATH: `C:\\Users\\User\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin;${inheritedPath}`,
  };
}

const windowsShell = process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe";

export function resetLocalDatabase() {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      execSync("npx.cmd --yes supabase@2.111.0 db reset --local --no-seed", {
        env: localCommandEnvironment(),
        shell: windowsShell,
        stdio: "pipe",
      });
      execSync("docker restart supabase_kong_imobflux", {
        env: localCommandEnvironment(),
        shell: windowsShell,
        stdio: "pipe",
      });
      execSync("powershell.exe -NoProfile -Command Start-Sleep -Seconds 8", {
        env: localCommandEnvironment(),
        shell: windowsShell,
        stdio: "pipe",
      });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export function loadDemoMode() {
  execSync("npx.cmd tsx scripts/demo-control.ts --load", {
    env: localCommandEnvironment(),
    shell: windowsShell,
    stdio: "pipe",
  });
}

export function cleanDemoMode() {
  execSync("npx.cmd tsx scripts/demo-control.ts --clean", {
    env: localCommandEnvironment(),
    shell: windowsShell,
    stdio: "pipe",
  });
}

export function resetAndLoadDemoMode() {
  resetLocalDatabase();
  loadDemoMode();
}

export function runLocalSql(sql: string) {
  execSync(
    "docker exec -i supabase_db_imobflux psql -h 127.0.0.1 -v ON_ERROR_STOP=1 -U postgres -d postgres",
    {
      env: localCommandEnvironment(),
      input: sql,
      shell: windowsShell,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
}

export function queryLocalSql(sql: string): string {
  return execSync(
    "docker exec -i supabase_db_imobflux psql -h 127.0.0.1 -t -A -v ON_ERROR_STOP=1 -U postgres -d postgres",
    {
      env: localCommandEnvironment(),
      input: sql,
      shell: windowsShell,
      stdio: ["pipe", "pipe", "pipe"],
    },
  ).toString().trim();
}

export async function loginAsDemoOwner(page: Page) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.goto("/login");
    await page.getByLabel("E-mail").fill(demoOwner.email);
    await page.getByLabel("Senha").fill(demoOwner.password);
    await page.getByRole("button", { name: "Entrar" }).click();
    try {
      await expect(page).toHaveURL(/\/prioridades$/, { timeout: 10_000 });
      return;
    } catch (error) {
      if (attempt === 3) throw error;
      await page.waitForTimeout(1_000);
    }
  }
}

export async function loginAsDemoAttendant(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(demoAttendant.email);
  await page.getByLabel("Senha").fill(demoAttendant.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/prioridades$/, { timeout: 10_000 });
}
