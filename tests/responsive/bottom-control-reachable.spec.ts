import { test, expect } from "@playwright/test";
import { routesUnderTest } from "./fixtures/routes";

/**
 * The last interactive control on a page must be scrollable into view AND
 * actually clickable once there.
 *
 * This is the test for the bug the whole programme starts from: the shell was
 * locked to 100vh with overflow hidden, so on a phone the bottom strip of
 * every page (pagination, Save) sat under the browser's address bar and could
 * not be reached at all.
 */
for (const route of routesUnderTest()) {
  test(`${route} lets you reach its bottom control`, async ({ page }) => {
    await page.goto(route);
    await page.waitForLoadState("networkidle");

    const controls = page.locator("button:visible, a[href]:visible");
    const count = await controls.count();
    test.skip(count === 0, "no interactive controls on this page");

    const last = controls.nth(count - 1);
    await last.scrollIntoViewIfNeeded();

    const reachable = await last.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const withinViewport =
        r.bottom <= window.innerHeight + 1 && r.top >= -1 && r.height > 0;
      const midX = r.x + r.width / 2;
      const midY = r.y + r.height / 2;
      const onTop = document.elementFromPoint(midX, midY);
      const clickable = !!onTop && (onTop === el || el.contains(onTop) || onTop.contains(el));
      return { withinViewport, clickable, bottom: r.bottom, innerHeight: window.innerHeight };
    });

    expect(
      reachable.withinViewport,
      `${route}: bottom control sits at y=${reachable.bottom} but the window is only ${reachable.innerHeight} tall, and scrolling did not bring it in`,
    ).toBe(true);
    expect(reachable.clickable, `${route}: bottom control is covered by something else`).toBe(true);
  });
}
