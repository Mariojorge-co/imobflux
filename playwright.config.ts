import { defineConfig, devices } from "@playwright/test";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

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
    baseURL: "http://127.0.0.1:3012",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3012",
    reuseExistingServer: true,
    timeout: 120_000,
    url: "http://127.0.0.1:3012/login",
  },
  workers: 1,
});
