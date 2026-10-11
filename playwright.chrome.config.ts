import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/**
 * Fallback config: run the responsive sweep on the Google Chrome already
 * installed on this machine, instead of Playwright's bundled browsers.
 *
 * Why this exists: downloading the bundled Chromium, Firefox and WebKit is
 * ~600MB and on a slow or scanned connection it can take hours. This config
 * needs no download at all, so the six viewport sizes can be measured today.
 *
 * What it does NOT give you: Firefox and WebKit. Chrome is one engine, so a
 * green run here proves layout and tap sizes, not cross-engine behaviour.
 * The full `playwright.config.ts` is still the one that proves the spec.
 */
export default defineConfig({
  ...base,
  projects: (base.projects ?? [])
    .filter((p) => p.name === "setup" || p.name?.endsWith("-chromium"))
    .map((p) => ({ ...p, use: { ...p.use, channel: "chrome" as const } })),
});
