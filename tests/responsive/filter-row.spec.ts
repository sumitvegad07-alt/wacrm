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

// ============================================================
// Filters that were offered and never applied.
//
// Ten screens read `filterState` and either ignored it or hand-handled a
// subset, so 49 controls did nothing. Invisible while filters hid behind a
// click on the heading; a visibly dead control once the filter row became
// permanent. These check the row count actually moves.
// ============================================================
test.describe("column filters really filter", () => {
  /** The footer's "1 - 10 of 696", which both paging modes keep honest. */
  async function totalRecords(page: import("@playwright/test").Page): Promise<number> {
    const text = await page.getByText(/\d+\s*-\s*\d+\s+of\s+\d+/).first().innerText();
    return Number(/of\s+(\d+)/.exec(text)![1]);
  }

  for (const [name, path] of [
    ["Customers", "/contacts"],
    ["Employees", "/team/employees"],
  ] as const) {
    test(`${name}: typing in the filter row changes what is listed`, async ({ page }) => {
      await page.goto(path);

      // Wait for the count to settle rather than racing the loading skeleton,
      // which is itself a single row and would read as "already filtered".
      await expect
        .poll(() => totalRecords(page), { timeout: 30_000 })
        .toBeGreaterThan(0);
      const before = await totalRecords(page);

      const firstText = page.locator("table thead tr").nth(1).locator("input").first();
      await firstText.fill("zzzqqqxxx"); // a string no record should contain

      await expect
        .poll(() => totalRecords(page), { timeout: 20_000 })
        .toBeLessThan(before);
    });
  }
});

test("the clear button clears the filter instead of opening the dropdown", async ({ page }) => {
  // A button inside a button is invalid HTML, and the click reached the
  // popover trigger first — so the x opened the dropdown and left the filter
  // in place.
  await page.goto("/contacts");

  const filterRow = page.locator("table thead tr").nth(1);
  await expect(filterRow).toBeVisible({ timeout: 30_000 });

  // Status ships filtered to Active, so there is a chip to clear on arrival.
  const clear = filterRow.getByRole("button", { name: "Clear Status filter" });
  await expect(clear).toBeVisible();
  await clear.click();

  // The chip is gone and no dropdown opened over the page.
  await expect(clear).toBeHidden();
  await expect(page.getByText("Filter by Status")).toBeHidden();
});

test("Manage Column on Employees lists every stored field", async ({ page }, testInfo) => {
  // The screen defined four columns and never loaded the account's field
  // configuration, so Contact Number — configured with show-in-table ON —
  // could not be added to the table at all. This was the missing phone number.
  await page.goto("/team/employees");
  await expect(page.locator("table thead tr").first()).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: /MANAGE COLUMN/i }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  for (const label of ["Contact Number", "Employee Code", "Email", "Department", "Designation"]) {
    await expect(dialog.getByText(label, { exact: true })).toBeVisible();
  }

  await testInfo.attach("employees-manage-column", {
    body: await page.screenshot({ fullPage: false }),
    contentType: "image/png",
  });
});

test.describe("Manage Column lists every stored field", () => {
  for (const [name, path, expected] of [
    ["Orders", "/orders", ["Sub Total", "Discount", "Tax", "Notes"]],
    ["Quotations", "/quotations", ["Version", "Valid Until", "Sub Total"]],
    ["Tasks", "/tasks", ["Description", "Start Date", "Reminder Date"]],
  ] as const) {
    test(`${name}`, async ({ page }) => {
      await page.goto(path);
      const header = page.locator("table thead tr").first();
      await expect(header).toBeVisible({ timeout: 30_000 });

      // The added columns are hidden until the user ticks one, so none of
      // them may be a heading on arrival.
      for (const label of expected) {
        await expect(header.getByText(label, { exact: true })).toHaveCount(0);
      }

      // …but every one of them must be offered.
      await page.getByRole("button", { name: /MANAGE COLUMN/i }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      for (const label of expected) {
        await expect(dialog.getByText(label, { exact: true })).toBeVisible();
      }
    });
  }
});
