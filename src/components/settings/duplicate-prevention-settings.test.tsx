import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DuplicatePreventionSettings } from "./duplicate-prevention-settings";

// ---------------------------------------------------------------------------
// The admin ticks which fields block a duplicate save. The screen has to be
// honest about one thing above all: Contact Number is enforced by a unique index
// whatever the setting says, so showing it as a tick the admin could clear would
// be a lie. It appears as a locked row that says so.
// ---------------------------------------------------------------------------

function noop() {}

function render(props: Partial<React.ComponentProps<typeof DuplicatePreventionSettings>> = {}) {
  return renderToStaticMarkup(
    <DuplicatePreventionSettings
      productUniqueKey="name"
      customerKeys={["name"]}
      leadKeys={[]}
      onChange={noop}
      {...props}
    />,
  );
}

/**
 * The labels whose CHECKBOX is ticked. Radios are excluded deliberately: the
 * product key is a single choice and always has one selected, so counting it
 * here would drown out what the tick lists actually say. Disabled rows are
 * excluded too — that is the locked Contact Number row, tested on its own.
 */
function checkedLabels(markup: string): string[] {
  const out: string[] = [];
  for (const label of markup.match(/<label[\s\S]*?<\/label>/g) ?? []) {
    if (!label.includes('type="checkbox"')) continue;
    if (label.includes("checked=") && !label.includes("disabled=")) {
      const text = label.replace(/<[^>]*>/g, "").trim();
      if (text) out.push(text);
    }
  }
  return out;
}

describe("DuplicatePreventionSettings", () => {
  test("shows the customer fields the account blocks on", () => {
    expect(checkedLabels(render({ customerKeys: ["name", "code"] }))).toEqual(
      expect.arrayContaining(["Name", "Customer Code"]),
    );
  });

  test("leads start with nothing ticked", () => {
    const markup = render({ leadKeys: [] });

    // Only the customer default (Name) should be ticked anywhere.
    expect(checkedLabels(markup)).toEqual(["Name"]);
  });

  test("says plainly that contact number is always on", () => {
    const markup = render();

    expect(markup).toContain("Contact Number");
    expect(markup).toContain("always");
  });

  test("the contact number row cannot be unticked", () => {
    // A tick an admin could clear, that changes nothing, is worse than no tick.
    const markup = render();
    const phoneRow = (markup.match(/<label[\s\S]*?<\/label>/g) ?? []).find((l) =>
      l.includes("Contact Number"),
    );

    expect(phoneRow).toBeDefined();
    expect(phoneRow).toContain("disabled");
  });

  test("warns that leads were never protected before", () => {
    // An admin needs to know ticking this starts rejecting saves that have
    // always been allowed.
    expect(render()).toContain("had no duplicate");
  });

  test("products keep their single choice, not tick boxes", () => {
    const markup = render({ productUniqueKey: "code" });

    expect(markup).toContain("Product unique key");
  });
});
