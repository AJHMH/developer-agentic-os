import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /hosted-command-centre\.spec\.ts/,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3101",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3101",
    env: { VERCEL: "1", HOSTED_AUTH_FIXTURE_MODE: "true", HOSTED_JSON_FIXTURE_MODE: "true" },
    url: "http://127.0.0.1:3101",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: "hosted-desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
    },
    {
      name: "hosted-mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true },
    },
  ],
});
