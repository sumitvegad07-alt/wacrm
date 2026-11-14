import { describe, it, expect } from "vitest";
import { gatePasses } from "./surface-gates";
import type { ProductLine } from "./catalog";

function ctx(dms: boolean) {
  const owns: Record<ProductLine, boolean> = {
    crm: true, wfa: true, sfa: true, fsm: false, dms,
  };
  return { owns, isModuleEnabled: () => true };
}

describe("a surface gated on the dms line", () => {
  it("passes for an account that holds the add-on", () => {
    expect(gatePasses({ line: "dms" }, ctx(true))).toBe(true);
  });

  it("is refused for an account that does not", () => {
    // Before this task this assertion passed for the wrong reason: owns.dms
    // was the constant false everywhere, so the gate could never be true.
    expect(gatePasses({ line: "dms" }, ctx(false))).toBe(false);
  });

  it("composes with anyLine, which is how DMS will be sold beside SFA", () => {
    expect(gatePasses({ anyLine: ["sfa", "dms"] }, ctx(false))).toBe(true);
    expect(gatePasses({ anyLine: ["dms"] }, ctx(false))).toBe(false);
    expect(gatePasses({ anyLine: ["dms"] }, ctx(true))).toBe(true);
  });
});
