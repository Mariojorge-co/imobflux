import { execSync } from "child_process";

export default async function globalSetup() {
  const env = {
    ...process.env,
    PATH: `C:\\Users\\User\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin;${process.env.PATH || ""}`,
  };

  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      execSync("npx.cmd --yes supabase@2.111.0 db reset --local --no-seed", {
        env,
        stdio: "pipe",
      });
      execSync("docker restart supabase_kong_imobflux", { env, stdio: "pipe" });
      execSync("powershell.exe -NoProfile -Command Start-Sleep -Seconds 8", {
        env,
        stdio: "pipe",
      });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  }
  throw lastError;
}
