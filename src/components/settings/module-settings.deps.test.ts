/**
 * Organisation Settings — the Save handler must see the CURRENT state.
 *
 * `handleSave` is a `useCallback`. React only rebuilds that closure when one of
 * its declared dependencies changes, so a piece of state left out of the array
 * is frozen at the value it had when the callback was last built — usually the
 * `useState` initial value. The Save button then reports success and writes the
 * OLD value, which is indistinguishable from "the setting does not work".
 *
 * That is not hypothetical. It shipped on 3 Nov 2026: `buyingStatusEnabled`,
 * `mappingMode` and `codeSettings` were all missing from the array, so Buying
 * Status, Customer mapping and Automatic codes each wrote their initial value
 * (`false`, `'off'`, every rule disabled) no matter what the admin picked. The
 * founder set Customer mapping to "Set on each customer", was told the save
 * succeeded, and the account kept `customer_mapping_mode: "off"` — which is why
 * the Supplied By box never appeared on the customer form.
 *
 * eslint's react-hooks/exhaustive-deps catches this, but only as a WARNING in
 * eslint-config-next, and this project carries enough warnings that one more
 * went unread. This test is the same check as an error, scoped to the one file
 * that holds every tenant's settings, and it fails the build.
 *
 * It is deliberately generic: it reads the component's own `useState`
 * declarations, so a state value added to the panel tomorrow is covered without
 * anybody remembering to update this list.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PANEL = join(process.cwd(), "src", "components", "settings", "module-settings.tsx");

/** `const [mappingMode, setMappingMode] = useState<MappingMode>('off');` → `mappingMode` */
const USE_STATE = /const\s*\[\s*([A-Za-z0-9_]+)\s*,\s*set[A-Za-z0-9_]+\s*\]\s*=\s*useState/g;

/**
 * Blank out comment bodies, keeping newlines, so a comment that names a state
 * value in prose (this file has several) is not mistaken for a read of it.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (b) => b.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (b) => " ".repeat(b.length));
}

/**
 * The `handleSave = useCallback(async () => { … }, [ … ]);` block: its body and
 * its dependency array, found by balancing brackets rather than by regex, so
 * the nested objects in the payload cannot end the match early.
 */
function readHandleSave(src: string): { body: string; deps: string[] } {
  const start = src.indexOf("const handleSave = useCallback(");
  expect(start, "handleSave should still be a useCallback in module-settings.tsx").toBeGreaterThan(-1);

  const bodyStart = src.indexOf("{", src.indexOf("=>", start));
  let depth = 0;
  let i = bodyStart;
  for (; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const body = src.slice(bodyStart, i + 1);

  const depsStart = src.indexOf("[", i);
  const depsEnd = src.indexOf("]", depsStart);
  const deps = src
    .slice(depsStart + 1, depsEnd)
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);

  return { body, deps };
}

describe("Organisation Settings Save handler", () => {
  const src = stripComments(readFileSync(PANEL, "utf8"));

  const stateNames = [...src.matchAll(USE_STATE)].map((m) => m[1]);

  it("declares state so the test has something to check", () => {
    // Guards the test itself: if the panel is rewritten to hold its state some
    // other way, this test must be rewritten too rather than silently passing.
    expect(stateNames.length).toBeGreaterThan(10);
    expect(stateNames).toContain("mappingMode");
    expect(stateNames).toContain("buyingStatusEnabled");
    expect(stateNames).toContain("codeSettings");
  });

  it("lists every piece of state it reads as a dependency", () => {
    const { body, deps } = readHandleSave(src);

    const read = stateNames.filter((name) =>
      new RegExp(`\\b${name}\\b`).test(body),
    );
    const missing = read.filter((name) => !deps.includes(name));

    expect(
      missing,
      missing.length
        ? `handleSave reads ${missing.join(", ")} but does not list ${
            missing.length === 1 ? "it" : "them"
          } as a dependency, so Save will write the value from an earlier render instead of what the admin just chose.`
        : "",
    ).toEqual([]);
  });

  /**
   * The other half of the same mistake. Discard is what the admin presses to
   * mean "forget what I just picked"; a control it does not reset keeps showing
   * an unsaved choice, so the panel then disagrees with the account and there
   * is nothing on screen to say which one is real.
   */
  it("puts every saved setting back on Discard", () => {
    const { body: saveBody } = readHandleSave(src);

    const discardStart = src.indexOf("const handleDiscard = ");
    expect(discardStart, "handleDiscard should still exist").toBeGreaterThan(-1);
    const discardBody = src.slice(discardStart, src.indexOf("\n  };", discardStart));

    // A setting counts as saved when Save writes it into the account payload.
    const saved = stateNames.filter((name) => new RegExp(`\\b${name}\\b`).test(saveBody));

    // `draft`, `originalSettings` and the toast are the panel's own bookkeeping,
    // not settings an admin picks, and Discard handles them its own way.
    const bookkeeping = new Set(["draft", "originalSettings", "toastMsg", "saving"]);

    const notRestored = saved.filter(
      (name) =>
        !bookkeeping.has(name) &&
        !new RegExp(`set${name[0].toUpperCase()}${name.slice(1)}\\s*\\(`).test(discardBody),
    );

    expect(
      notRestored,
      notRestored.length
        ? `handleDiscard does not reset ${notRestored.join(", ")}, so Discard leaves ${
            notRestored.length === 1 ? "that control" : "those controls"
          } showing a value the account never saved.`
        : "",
    ).toEqual([]);
  });
});
