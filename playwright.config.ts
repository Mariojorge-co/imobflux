import { defineConfig, devices } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import webpush from "web-push";

loadEnvConfig(process.cwd());

// Avisos com o app fechado (Web Push): os testes NUNCA usam chaves reais. Cada execução gera um par VAPID descartável em memória
// (não é impresso nem gravado) e o repassa ao servidor de teste. IMOBFLUX_TEST_VAPID=off sobe o servidor SEM chaves (recurso desligado).
if (process.env.IMOBFLUX_TEST_VAPID === "off") {
  process.env.VAPID_PRIVATE_KEY = "";
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "";
  process.env.VAPID_SUBJECT = "";
} else {
  const vapid = webpush.generateVAPIDKeys();
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = vapid.publicKey;
  process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
  process.env.VAPID_SUBJECT = "mailto:testes@example.test";
}

export default defineConfig({
  globalSetup: "./tests/global-setup.ts",
  expect: {
    timeout: 5_000,
  },
  fullyParallel: false,
  projects: [
    {
      name: "chrome",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
      },
    },
  ],
  reporter: "list",
  retries: 0,
  testDir: "./tests",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: process.platform === "win32" ? "npm.cmd run dev" : "npm run dev",
    reuseExistingServer: true,
    timeout: 120_000,
    url: "http://localhost:3000/login",
  },
  workers: 1,
});
