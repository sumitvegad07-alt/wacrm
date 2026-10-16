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

test.describe("filter row value lists", () => {
  test("the Lead Owner dropdown offers the account's staff", async ({ page }, testInfo) => {
    await page.goto("/leads");

    const filterRow = page.locator("table thead tr").nth(1);
    await expect(filterRow).toBeVisible({ timeout: 30_000 });

    await filterRow.getByRole("button", { name: "Filter by Lead Owner" }).click();

    // Nothing is fetched until the dropdown opens, so the names arrive after
    // the click rather than with the page.
    const options = page.getByRole("checkbox");
    await expect(options.first()).toBeVisible({ timeout: 15_000 });
    expect(await options.count()).toBeGreaterThan(0);

    await testInfo.attach("lead-owner-dropdown", {
      body: await page.screenshot({ fullPage: false }),
      contentType: "image/png",
    });
  });

  test("the Customers table has a filter row too", async ({ page }, testInfo) => {
    await page.goto("/contacts");

    const headerRows = page.locator("table thead tr");
    await expect(headerRows.first()).toBeVisible({ timeout: 30_000 });
    await expect(headerRows).toHaveCount(2);

    const headingCells = await headerRows.nth(0).locator("th").count();
    const filterCells = await headerRows.nth(1).locator("th").count();
    expect(filterCells).toBe(headingCells);

    await testInfo.attach("customers-filter-row", {
      body: await page.screenshot({ fullPage: false }),
      contentType: "image/png",
    });
  });
});

test.describe("distinct value lists", () => {
  test("the Company Name dropdown lists companies from the account's own rows", async ({
    page,
  }, testInfo) => {
    await page.goto("/contacts");

    const filterRow = page.locator("table thead tr").nth(1);
    await expect(filterRow).toBeVisible({ timeout: 30_000 });

    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/table/column-values") && r.request().method() === "GET",
        { timeout: 20_000 },
      ),
      filterRow.getByRole("button", { name: "Filter by Company Name" }).click(),
    ]);

    expect(response.ok(), "column-values must not error").toBe(true);
    const payload = await response.json();
    expect(Array.isArray(payload.values)).toBe(true);
    expect(payload.values.length, "this account has customers, so it has companies").toBeGreaterThan(0);

    await expect(page.getByRole("checkbox").first()).toBeVisible({ timeout: 10_000 });

    await testInfo.attach("company-name-dropdown", {
      body: await page.screenshot({ fullPage: false }),
      contentType: "image/png",
    });
  });
});
