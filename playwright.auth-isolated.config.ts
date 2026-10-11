import { defineConfig, devices } from "@playwright/test";
import { readFileSync } from "node:fs";

// Run only from a disposable COPY, with its own Supabase and explicit env.
// Deliberately does not load .env, reset databases or invoke global-setup.ts.
const databaseUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "http://invalid");
const config = readFileSync("supabase/config.toml", "utf8");
if (process.env.IMOBFLUX_AUTH_TEST_DISPOSABLE !== "1"
  || !["localhost", "127.0.0.1"].includes(databaseUrl.hostname)
  || databaseUrl.port !== "56321"
  || !/^project_id\s*=\s*"imobflux-auth-disposable[^"]*"/m.test(config)
  || !process.env.SUPABASE_ADMIN_KEY || !process.env.NEXT_PUBLIC_SUPABASE_CLIENT_KEY) {
  throw new Error("Use somente uma cópia descartável imobflux-auth-disposable, Supabase loopback:56321 e variáveis efêmeras explícitas.");
}

export default defineConfig({
  testDir: "./isolated-tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 60_000,
  use: { baseURL: "http://localhost:3100", trace: "off", screenshot: "off" },
  projects: [{ name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],
  webServer: {
    command: "npm.cmd run dev -- --port 3100",
    url: "http://localhost:3100/login",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
