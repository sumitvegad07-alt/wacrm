import { describe, expect, test } from "vitest";
import { visibleSectionFields } from "./visible-fields";

// ---------------------------------------------------------------------------
// A section header used to paint even when every field under it was hidden.
//
// The renderer decided "does this section have fields?" from the raw list, but
// `renderCustomSystemField` can veto an individual field (returning null) only
// later, inside the field loop. The Task/Activity form hides both of its
// "Schedule & Priority" fields that way — Scheduled Date and Priority are drawn
// higher up in a fixed order — so the form showed a heading with nothing under
// it and the dialog grew tall enough to push Create Task off screen.
//
// These tests pin the three-way contract the forms rely on (see the
// custom-fields render contract): null = hide the field, undefined = draw it the
// default way, a node = draw that node instead.
// ---------------------------------------------------------------------------

interface Field {
  id: string;
  system_key?: string;
}

const dateField: Field = { id: "f1", system_key: "due_date" };
const priorityField: Field = { id: "f2", system_key: "priority" };
const plainField: Field = { id: "f3" };

describe("visibleSectionFields", () => {
  test("keeps every field when the form supplies no custom renderer", () => {
    const visible = visibleSectionFields([dateField, plainField]);

    expect(visible.map((v) => v.field.id)).toEqual(["f1", "f3"]);
  });

  test("drops a field the form hid by returning null", () => {
    const visible = visibleSectionFields([dateField, plainField], (f) =>
      f.system_key === "due_date" ? null : undefined,
    );

    expect(visible.map((v) => v.field.id)).toEqual(["f3"]);
  });

  test("keeps a field the form left to the default renderer (undefined)", () => {
    const visible = visibleSectionFields([plainField], () => undefined);

    expect(visible).toHaveLength(1);
    expect(visible[0].customNode).toBeUndefined();
  });

  test("carries a replacement node through so the renderer need not ask twice", () => {
    const visible = visibleSectionFields([plainField], () => "custom");

    expect(visible[0].customNode).toBe("custom");
  });

  test("returns nothing when the form hid every field, so the header can go too", () => {
    const visible = visibleSectionFields([dateField, priorityField], (f) =>
      f.system_key === "due_date" || f.system_key === "priority" ? null : undefined,
    );

    expect(visible).toEqual([]);
  });
});
