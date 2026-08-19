import { describe, expect, it } from 'vitest';
import { detectEligibleSchemes } from './detectEligibleSchemes';
import { FIXTURE_PRODUCTS, SCHEME_DETECTION_FIXTURES } from './fixtures';

/**
 * Runs the shared scheme-detection fixtures against the TypeScript advisory
 * brain. The SAME fixtures are run against the SQL `detect_eligible_schemes`
 * function — see sql-parity.md. Both sides must agree; the fixtures are the
 * contract, not either implementation.
 */
describe('detectEligibleSchemes (advisory mirror)', () => {
  for (const fixture of SCHEME_DETECTION_FIXTURES) {
    it(`${fixture.name} — ${fixture.proves}`, () => {
      const result = detectEligibleSchemes(
        fixture.lines,
        FIXTURE_PRODUCTS,
        fixture.schemes,
        fixture.contactId,
        fixture.asOf,
      );

      expect(result.lineSchemes).toHaveLength(fixture.expect.lineSchemes.length);
      fixture.expect.lineSchemes.forEach((expected, i) => {
        const actual = result.lineSchemes[i];
        expect(actual.position).toBe(expected.position);
        expect(actual.schemeId).toBe(expected.schemeId);
        expect(actual.rewardType).toBe(expected.rewardType);
        expect(actual.schemeDiscountAmount).toBeCloseTo(expected.schemeDiscountAmount, 2);
        expect(actual.freeQty).toBe(expected.freeQty);
        expect(actual.defaultSelected).toBe(expected.defaultSelected);
      });

      expect(result.orderSchemes).toHaveLength(fixture.expect.orderSchemes.length);
      fixture.expect.orderSchemes.forEach((expected, i) => {
        const actual = result.orderSchemes[i];
        expect(actual.schemeId).toBe(expected.schemeId);
        expect(actual.discountAmount).toBeCloseTo(expected.discountAmount, 2);
        expect(actual.appliesToPositions).toEqual(expected.appliesToPositions);
      });
    });
  }
});
