import { defineConfig } from "@playwright/test";

// No globalSetup, web server, .env loading or database commands.
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.unit.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
});
