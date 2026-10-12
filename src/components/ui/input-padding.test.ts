import postcss, { type Rule } from "postcss";
import tailwind from "@tailwindcss/postcss";
import { describe, expect, it } from "vitest";
import { twMerge } from "tailwind-merge";
import { inputBaseClassName } from "./input";

/**
 * Every search box in the app is `<div className="relative">` + an absolutely
 * positioned icon + `<Input className="pl-8|pl-9" />`. That only works if the
 * caller's `pl-*` actually reaches the element.
 *
 * It did not. The base class carried `md:px-2.5`; tailwind-merge will not drop
 * a base class whose variant differs from the caller's, so both shipped, and
 * Tailwind emits `@media` rules after plain ones at the same specificity - so
 * at >=768px the base won and padding-left fell back to 10px. The magnifier
 * then sat on top of the placeholder on every desktop screen.
 */

const PADDING_LEFT = /^padding(-left|-inline(-start)?)?$/;

/**
 * Compile the given utilities and list, in emission order, the selector of
 * every rule that sets padding-left.
 *
 * Walked as a real PostCSS tree rather than matched with a regex: Tailwind v4
 * emits a responsive utility as `.md\:px-2\.5 { @media (...) { ... } }`, and a
 * regex that stops at the first nested brace skips exactly the declarations
 * this test exists to catch.
 */
async function paddingLeftSetters(classes: string[]): Promise<string[]> {
  const source = [
    '@import "tailwindcss" source(none);',
    ...classes.map((c) => `@source inline(${JSON.stringify(c)});`),
  ].join("\n");
  const root = (await postcss([tailwind()]).process(source, { from: "probe.css" })).root;

  const setters: string[] = [];
  root.walkDecls((decl) => {
    if (!PADDING_LEFT.test(decl.prop)) return;
    // Nearest enclosing rule - may be a few levels up through @media/@supports.
    let node: { type: string; parent?: unknown } | undefined = decl.parent;
    while (node && node.type !== "rule") {
      node = node.parent as { type: string; parent?: unknown } | undefined;
    }
    if (node) setters.push((node as unknown as Rule).selector.replace(/\\/g, ""));
  });
  return setters;
}

describe("Input base classes", () => {
  it("declares horizontal padding without a responsive variant", () => {
    const responsivePadding = inputBaseClassName.match(
      /\b(?:sm|md|lg|xl|2xl):p[xlrstbe]?-[\w.[\]()-]+/g,
    );

    expect(
      responsivePadding,
      "A responsive padding utility in the base class cannot be overridden by a caller's " +
        "plain `pl-*`/`pr-*` - tailwind-merge keeps both and the media query wins. " +
        "Write the base padding unprefixed.",
    ).toBeNull();
  });

  it("gives a caller's pl-9 the last word on padding-left", async () => {
    // What the element actually ships with: base merged with an icon search box.
    const merged = twMerge(inputBaseClassName, "pl-9 bg-background").split(/\s+/).filter(Boolean);
    const setters = await paddingLeftSetters(merged);

    // All single-class selectors of equal specificity, so the last one wins -
    // including any nested inside a media query.
    expect(
      setters.at(-1),
      `padding-left is last set by "${setters.at(-1)}", not by the caller's ".pl-9". ` +
        `Emission order was: ${setters.join(" then ")}`,
    ).toBe(".pl-9");
  });

  it("negative control: a responsive base padding does defeat pl-9", async () => {
    // The exact base this bug shipped with. If this ever stops failing to put
    // .pl-9 last, the test above has stopped being able to detect the bug.
    const broken = twMerge("px-3 md:px-2.5 py-1", "pl-9").split(/\s+/).filter(Boolean);
    const setters = await paddingLeftSetters(broken);

    expect(setters).toContain(".md\\:px-2\\.5".replace(/\\/g, ""));
    expect(setters.at(-1)).not.toBe(".pl-9");
  });
});
