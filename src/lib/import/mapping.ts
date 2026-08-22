import type { ColumnMapping, ImportDescriptor, MappingConfidence } from "./types";
import { normalizeKey } from "./parse";

// Layered auto-mapping: (1) exact normalized match, (2) synonym dictionary,
// (3) fuzzy/edit-distance. Content-sniffing is a future tie-breaker; not needed
// for the flat Product Units pilot. Each mapping carries a confidence the UI
// surfaces so the user never has to guess what the machine guessed.

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

interface Score {
  fieldKey: string;
  confidence: MappingConfidence;
  score: number;
}

function scoreHeader(normHeader: string, descriptor: ImportDescriptor): Score | null {
  let best: Score | null = null;

  for (const field of descriptor.fields) {
    const candidates = [field.key, field.label, ...field.synonyms].map(normalizeKey);
    let confidence: MappingConfidence = "none";
    let score = 0;

    for (const cand of candidates) {
      if (!cand) continue;
      if (cand === normHeader) {
        confidence = "high";
        score = Math.max(score, 100);
        break;
      }
      // Substring either direction, but only for meaningful lengths (avoid "id" noise).
      if (cand.length >= 3 && normHeader.length >= 3 && (cand.includes(normHeader) || normHeader.includes(cand))) {
        if (score < 70) {
          confidence = "medium";
          score = 70;
        }
        continue;
      }
      const dist = levenshtein(cand, normHeader);
      const ratio = dist / Math.max(cand.length, normHeader.length);
      if (ratio <= 0.25 && score < 55) {
        confidence = "low";
        score = 55;
      }
    }

    if (score > 0 && (best === null || score > best.score)) {
      best = { fieldKey: field.key, confidence, score };
    }
  }

  return best;
}

/**
 * Produce a mapping decision for every source column. If two columns claim the
 * same field, the higher-scoring one keeps it and the other is left unmapped so
 * a value is never silently written into the wrong (or a duplicated) field.
 */
export function detectMapping(headers: string[], descriptor: ImportDescriptor): ColumnMapping[] {
  const mappings: ColumnMapping[] = headers.map((h, i) => ({
    sourceHeader: h,
    sourceIndex: i,
    fieldKey: null,
    confidence: "none",
    auto: true,
  }));

  const bestForColumn = headers.map((h) => (h.trim() ? scoreHeader(normalizeKey(h), descriptor) : null));

  // Assign fields greedily by descending score, one field per column.
  const takenFields = new Set<string>();
  const order = bestForColumn
    .map((s, i) => ({ i, s }))
    .filter((x) => x.s !== null)
    .sort((a, b) => (b.s!.score - a.s!.score));

  for (const { i, s } of order) {
    if (!s || takenFields.has(s.fieldKey)) continue;
    mappings[i].fieldKey = s.fieldKey;
    mappings[i].confidence = s.confidence;
    takenFields.add(s.fieldKey);
  }

  return mappings;
}

/** Field keys currently mapped (ignores null / duplicate-cleared columns). */
export function mappedFieldKeys(mappings: ColumnMapping[]): Set<string> {
  return new Set(mappings.map((m) => m.fieldKey).filter((k): k is string => !!k));
}

/** Required fields that no column maps to — these block the Continue button. */
export function unmappedRequiredFields(
  mappings: ColumnMapping[],
  descriptor: ImportDescriptor,
): string[] {
  const mapped = mappedFieldKeys(mappings);
  return descriptor.fields.filter((f) => f.required && !mapped.has(f.key)).map((f) => f.label);
}
