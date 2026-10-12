// ============================================================
// Deterministic randomness for the demo tenants.
//
// mulberry32, the same generator the Play Console seed script uses. Seeded per
// tenant, so the same tenant key always produces the same names, phone numbers
// and coordinates — a teardown followed by a re-seed reproduces the tenant
// exactly, and a bug is reproducible rather than "it looked different that time".
// ============================================================

export interface Rng {
  /** Raw float in [0, 1). */
  next(): number;
  /** Uniform integer in [lo, hi], both inclusive. */
  between(lo: number, hi: number): number;
  /** One element of the array. Throws on empty rather than returning undefined. */
  pick<T>(arr: readonly T[]): T;
  /** True with the given probability (0–1). */
  chance(p: number): boolean;
  /** Float in [lo, hi), rounded to `places`. */
  float(lo: number, hi: number, places?: number): number;
  /**
   * An amount that never ends in a round hundred, so prices read as real
   * invoices (1,245) rather than as seed data (1,000).
   */
  messyAmount(lo: number, hi: number): number;
}

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const between = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));

  return {
    next,
    between,
    pick<T>(arr: readonly T[]): T {
      if (arr.length === 0) throw new Error("rng.pick called with an empty array");
      return arr[Math.floor(next() * arr.length)];
    },
    chance: (p: number) => next() < p,
    float: (lo: number, hi: number, places = 6) =>
      Number((lo + next() * (hi - lo)).toFixed(places)),
    messyAmount(lo: number, hi: number) {
      const base = between(lo, hi);
      // Force a non-zero rupee tail. 17..98 avoids both ...00 and a suspicious
      // run of ...01 values.
      return Math.floor(base / 100) * 100 + between(17, 98);
    },
  };
}

/**
 * A stable 32-bit seed from a string, so each tenant gets its own independent
 * stream from its key alone and adding a tenant never reshuffles another's data.
 */
export function seedFromString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * Unique-value generator backed by a Set. `contacts.name` is the account's
 * duplicate key and `phone_normalized` carries a unique index, so generated
 * names and phones have to be unique inside a tenant or the insert fails
 * halfway through.
 */
export function uniqueMaker(build: (attempt: number) => string): () => string {
  const seen = new Set<string>();
  return () => {
    for (let i = 0; i < 5000; i++) {
      const v = build(i);
      const k = v.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        return v;
      }
    }
    throw new Error("could not generate a unique value after 5000 attempts");
  };
}
