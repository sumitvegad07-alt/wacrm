import { test, expect } from "@playwright/test";
import { routesUnderTest } from "./fixtures/routes";

const TOUCH_MIN = 44;

/**
 * Below 768px every control needs a 44px tap target.
 *
 * Three controls are deliberately small on screen and grow their tap area with
 * an `::after` overlay instead — the pattern radio-group.tsx already uses in
 * this repo. For those we measure the overlay, not the visible box.
 */
const PSEUDO_TARGET_SLOTS = ["checkbox", "radio-group-item", "switch"];

test.describe("touch targets", () => {
  for (const route of routesUnderTest()) {
    test(`${route} has thumb-sized controls`, async ({ page }, testInfo) => {
      const width = testInfo.project.use.viewport?.width ?? 0;
      test.skip(width >= 768, "44px rule applies below 768px only");

      await page.goto(route);
      await page.waitForLoadState("networkidle");

      const tooSmall = await page.evaluate(
        ({ min, pseudoSlots }) => {
          const offenders: string[] = [];
          const nodes = document.querySelectorAll<HTMLElement>(
            "button, a[href], input, select, textarea, [role='button'], [role='tab'], [role='menuitem']",
          );
          for (const el of Array.from(nodes)) {
            const box = el.getBoundingClientRect();
            if (box.width === 0 || box.height === 0) continue; // hidden

            const slot = el.getAttribute("data-slot") ?? "";
            let { width, height } = box;

            if (pseudoSlots.includes(slot)) {
              const after = getComputedStyle(el, "::after");
              const px = (v: string) => (v.endsWith("px") ? parseFloat(v) : 0);
              width += Math.abs(px(after.left)) + Math.abs(px(after.right));
              height += Math.abs(px(after.top)) + Math.abs(px(after.bottom));
            }

            if (width < min || height < min) {
              offenders.push(
                `${el.tagName.toLowerCase()}${slot ? `[${slot}]` : ""} ` +
                  `"${(el.textContent ?? "").trim().slice(0, 25)}" ` +
                  `${Math.round(width)}x${Math.round(height)}`,
              );
            }
          }
          return offenders;
        },
        { min: TOUCH_MIN, pseudoSlots: PSEUDO_TARGET_SLOTS },
      );

      expect(
        tooSmall,
        `${route} has controls below ${TOUCH_MIN}px:\n${tooSmall.join("\n")}`,
      ).toEqual([]);
    });
  }
});
