import { test as setup, expect } from "@playwright/test";
import path from "node:path";

const STORAGE_STATE = path.join(__dirname, ".auth", "user.json");

setup("log in once and save the session", async ({ page }) => {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "Set E2E_EMAIL and E2E_PASSWORD in .env.test.local (see .env.test.local.example). " +
        "These tests never create, edit or delete anything — they only open pages and " +
        "measure them — but every dashboard route is behind a login.",
    );
  }

  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(page).toHaveURL(/\/(dashboard|getting-started)/, { timeout: 30_000 });
  await page.context().storageState({ path: STORAGE_STATE });
});
