import { describe, expect, it } from "vitest";
import { formatAddress } from "./address";

describe("formatAddress", () => {
  it("does not repeat city, state and country the address already carries", () => {
    // Verbatim from the founder's Dispatch screen, 2026-11-06. It read
    // "... 360005, India, Rajkot, Gujarat, India".
    expect(
      formatAddress([
        "Rajkot West Taluka, Rajkot, Gujarat, 360005, India",
        "Rajkot",
        "Gujarat",
        "India",
      ]),
    ).toBe("Rajkot West Taluka, Rajkot, Gujarat, 360005, India");
  });

  it("still appends the parts a short street address is missing", () => {
    expect(formatAddress(["12 MG Road", "Rajkot", "Gujarat", "India"])).toBe(
      "12 MG Road, Rajkot, Gujarat, India",
    );
  });

  it("keeps a city whose name is only part of the street", () => {
    // "Rajkot" inside "Rajkot West Taluka" must NOT swallow the city, which is
    // why pieces are compared whole rather than as substrings.
    expect(formatAddress(["Rajkot West Taluka", "Rajkot", "Gujarat"])).toBe(
      "Rajkot West Taluka, Rajkot, Gujarat",
    );
  });

  it("ignores case and stray punctuation", () => {
    expect(formatAddress(["Near Temple, RAJKOT,", "rajkot", "Gujarat"])).toBe(
      "Near Temple, RAJKOT, Gujarat",
    );
  });

  it("drops blanks and nullish parts", () => {
    expect(formatAddress([null, "  ", "Rajkot", undefined, "Gujarat"])).toBe("Rajkot, Gujarat");
  });

  it("is empty when there is nothing to show", () => {
    expect(formatAddress([null, undefined, "", "  ,  "])).toBe("");
  });

  it("does not collapse two genuinely different parts", () => {
    expect(formatAddress(["Shop 4", "Amin Marg", "Rajkot", "Gujarat", "India"])).toBe(
      "Shop 4, Amin Marg, Rajkot, Gujarat, India",
    );
  });
});
