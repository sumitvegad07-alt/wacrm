import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { VIEWPORTS } from "./tests/responsive/fixtures/viewports";

/**
 * Load `.env.test.local` into the environment.
 *
 * Playwright does not read Next.js env files, and this one is deliberately
 * separate from `.env.local`: it holds only the login the read-only sweep
 * signs in with, and it is git-ignored. Parsed by hand to avoid adding a
 * dotenv dependency for four lines of work.
 */
function loadTestEnv(): void {
  const file = join(process.cwd(), ".env.test.local");
  if (!existsSync(file)) return;

  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadTestEnv();

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const STORAGE_STATE = "tests/responsive/.auth/user.json";

/**
 * Engines: Chromium, Firefox and WebKit (Safari's engine) at six sizes.
 *
 * The layout suites run on all three engines at every size. WebKit is how
 * iPhone and iPad are covered: same engine, so CSS and layout behaviour is
 * accurate, but it does not reproduce iOS address-bar or keyboard behaviour —
 * that needs a real device, as the spec says.
 */
const engines = [
  { key: "chromium", use: devices["Desktop Chrome"] },
  { key: "firefox", use: devices["Desktop Firefox"] },
  { key: "webkit", use: devices["Desktop Safari"] },
] as const;

export default defineConfig({
  testDir: "./tests/responsive",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["html", { open: "never" }], ["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    ...engines.flatMap(({ key, use }) =>
      VIEWPORTS.map((vp) => ({
        name: `${vp.name}-${key}`,
        use: {
          ...use,
          viewport: { width: vp.width, height: vp.height },
          storageState: STORAGE_STATE,
        },
        dependencies: ["setup"],
        testIgnore: /auth\.setup\.ts/,
      })),
    ),
  ],
  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
