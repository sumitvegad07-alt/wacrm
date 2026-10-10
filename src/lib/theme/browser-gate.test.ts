import { describe, expect, it } from "vitest";
import { BROWSER_GATE_SCRIPT } from "./browser-gate";

describe("BROWSER_GATE_SCRIPT", () => {
  it("is plain ES5 so the browsers it judges can actually run it", () => {
    // Arrow functions, const/let, template literals and optional chaining
    // would themselves fail to parse on the browsers this gate exists to
    // catch, leaving a blank page instead of the message.
    expect(BROWSER_GATE_SCRIPT).not.toMatch(/=>/);
    expect(BROWSER_GATE_SCRIPT).not.toMatch(/\b(const|let)\s/);
    expect(BROWSER_GATE_SCRIPT).not.toMatch(/`/);
    expect(BROWSER_GATE_SCRIPT).not.toMatch(/\?\./);
  });

  it("tests the features the app actually needs", () => {
    expect(BROWSER_GATE_SCRIPT).toContain("CSS.supports");
    expect(BROWSER_GATE_SCRIPT).toContain("--x:0"); // custom properties
    expect(BROWSER_GATE_SCRIPT).toContain("display:grid");
    expect(BROWSER_GATE_SCRIPT).toContain("Promise");
  });

  it("never blocks a browser that passes every check", () => {
    expect(BROWSER_GATE_SCRIPT).toContain("if (ok) return");
  });

  it("tells the user what to do, in plain words", () => {
    expect(BROWSER_GATE_SCRIPT).toMatch(/update/i);
  });

  it("lets a supported browser through and blocks an unsupported one", () => {
    const run = (cssSupports: ((decl: string) => boolean) | null) => {
      const appended: unknown[] = [];
      const element = () => ({
        setAttribute() {},
        style: { cssText: "" },
        id: "",
        innerHTML: "",
      });
      const fakeWindow: Record<string, unknown> = {
        Promise,
        fetch: () => {},
        CSS: cssSupports ? { supports: cssSupports } : undefined,
      };
      const fakeDocument = {
        body: { appendChild: (node: unknown) => appended.push(node) },
        createElement: element,
        addEventListener() {},
      };

      // The gate is a bare IIFE referencing `window` and `document`, so run it
      // with those bound to fakes rather than parsing it by hand.
      new Function(
        "window",
        "document",
        "Promise",
        `${BROWSER_GATE_SCRIPT}`,
      )(fakeWindow, fakeDocument, Promise);

      return appended.length;
    };

    // A modern browser: everything supported, nothing injected.
    expect(run(() => true)).toBe(0);

    // An old browser: CSS.supports says no, so the message is shown.
    expect(run(() => false)).toBe(1);

    // A very old browser with no CSS object at all.
    expect(run(null)).toBe(1);
  });
});
