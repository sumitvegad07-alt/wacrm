import { test, expect } from "@playwright/test";
import { routesUnderTest } from "./fixtures/routes";

/**
 * A page must never be wider than the window. One pixel of slack absorbs
 * sub-pixel rounding, which differs between the three engines.
 */
for (const route of routesUnderTest()) {
  test(`${route} does not scroll sideways`, async ({ page }) => {
    await page.goto(route);
    await page.waitForLoadState("networkidle");

    const { scrollWidth, clientWidth, widest } = await page.evaluate(() => {
      const doc = document.documentElement;
      let widest = "";
      let worst = 0;
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
        const right = el.getBoundingClientRect().right;
        if (right > worst) {
          worst = right;
          widest =
            el.tagName.toLowerCase() +
            (el.className && typeof el.className === "string"
              ? "." + el.className.split(/\s+/).slice(0, 3).join(".")
              : "");
        }
      }
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, widest };
    });

    expect(
      scrollWidth,
      `${route} is ${scrollWidth - clientWidth}px wider than the window. Widest element: ${widest}`,
    ).toBeLessThanOrEqual(clientWidth + 1);
  });
}
