import { test, expect } from "@playwright/test";

/**
 * The filter row is a permanent second row under the table headings. It has to
 * line up with them — it carries one cell per visible column plus the leading
 * cells for the checkbox and the pinned Action column — and it must not push
 * the page into horizontal scroll on a phone.
 *
 * Read-only, like the rest of this suite: it opens the page and measures it.
 */
test.describe("table filter row", () => {
  test("lines up with the headings and does not overflow the page", async ({ page }, testInfo) => {
    await page.goto("/leads");

    const headerRows = page.locator("table thead tr");
    await expect(headerRows.first()).toBeVisible({ timeout: 30_000 });
    await expect(headerRows).toHaveCount(2);

    const headingCells = await headerRows.nth(0).locator("th").count();
    const filterCells = await headerRows.nth(1).locator("th").count();
    expect(filterCells, "filter row must carry one cell per heading").toBe(headingCells);

    // The page itself must not scroll sideways, whatever the table does inside
    // its own scroller.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "page scrolls horizontally").toBeLessThanOrEqual(1);

    await testInfo.attach("leads-filter-row", {
      body: await page.screenshot({ fullPage: false }),
      contentType: "image/png",
    });
  });
});
