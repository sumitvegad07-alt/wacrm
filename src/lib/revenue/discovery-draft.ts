// ============================================================
// Lead Discovery — remembering what you typed, and where a harvest got to.
//
// WHY THIS EXISTS
//
// Everything on the discover page lived in React state in one browser tab. Two
// ordinary things wiped it:
//
//   1. Chrome's Memory Saver discards a tab left in the background for a while.
//      It reloads blank when you come back — the form empty, a running harvest
//      dead.
//   2. Clicking any other item in the admin menu unmounts the page. The harvest
//      loop keeps fetching into a component nobody can see, and its rows are
//      unreachable.
//
// Re-typing an industry, a state and twenty districts after each of those is the
// actual complaint. So the form is written to localStorage as it is filled in,
// and a harvest in flight records which search it is on.
//
// WHY EVERYTHING READ BACK IS RE-VALIDATED
//
// A stored draft can be months old, hand-edited in devtools, or written by an
// older build whose industry list has since changed. Restoring "Pune" as a
// district of Karnataka would build a plan for a place that is not in the state
// and spend quota on nothing, so what comes out of storage is checked against
// the live taxonomy and seed geography, not trusted.
// ============================================================

import { listAreas, listDistricts, listStates } from "./discovery-geography";
import { findCategory, findIndustry } from "./discovery-taxonomy";

export interface DiscoveryDraft {
  industry: string;
  category: string;
  state: string;
  districts: string[];
  areas: string[];
  pincode: string;
  includeWithoutPhone: boolean;
  ignoreSeen: boolean;
}

/**
 * A blank form. Every field starts empty on purpose: the page used to open on
 * Seeds / Manufacturer / Karnataka, which reads as a choice already made and is
 * wrong for most harvests.
 */
export const EMPTY_DRAFT: DiscoveryDraft = {
  industry: "",
  category: "",
  state: "",
  districts: [],
  areas: [],
  pincode: "",
  includeWithoutPhone: false,
  ignoreSeen: false,
};

export interface DiscoveryProgress {
  runId: string;
  /** The first search of the plan that has not been done yet. */
  nextIndex: number;
  planLength: number;
  savedAt: string;
}

/**
 * How long an unfinished harvest is still worth offering to resume.
 *
 * Shorter than the 45-day search-reuse window on purpose. Resuming an older run
 * would work and would cost nothing, but a "resume last week's harvest" banner
 * on a page opened for something else is noise, not help.
 */
export const PROGRESS_MAX_AGE_DAYS = 7;

export const DRAFT_KEY = "ozzo:discover:draft";
export const PROGRESS_KEY = "ozzo:discover:progress";

// ── validation ──────────────────────────────────────────────

/** Whatever came out of storage, turned into a draft this build can act on. */
export function sanitizeDraft(raw: unknown): DiscoveryDraft {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { ...EMPTY_DRAFT };
  const input = raw as Record<string, unknown>;

  const industry = findIndustry(asString(input.industry))?.value ?? "";
  const category = findCategory(asString(input.category))?.value ?? "";

  const stateName = asString(input.state);
  const state = listStates().some((option) => option.value === stateName) ? stateName : "";

  // No state means no geography: districts and areas belong to a state, and a
  // district kept without one cannot be checked against anything later.
  if (state === "") {
    return { ...EMPTY_DRAFT, industry, category, pincode: asPincode(input.pincode) };
  }

  const allowedDistricts = new Set(listDistricts(state).map((option) => option.value));
  const districts = uniqueStrings(input.districts).filter((d) => allowedDistricts.has(d));

  const allowedAreas = new Set(listAreas(state, districts).map((option) => option.value));
  const areas = uniqueStrings(input.areas).filter((a) => allowedAreas.has(a));

  return {
    industry,
    category,
    state,
    districts,
    areas,
    pincode: asPincode(input.pincode),
    includeWithoutPhone: input.includeWithoutPhone === true,
    ignoreSeen: input.ignoreSeen === true,
  };
}

/**
 * A resumable harvest, or null when there is nothing worth offering.
 *
 * `now` is a parameter so the staleness rule can be tested without faking the
 * clock.
 */
export function sanitizeProgress(raw: unknown, now: Date = new Date()): DiscoveryProgress | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;

  const runId = asString(input.runId).trim();
  if (runId === "") return null;

  const planLength = input.planLength;
  if (!Number.isInteger(planLength) || (planLength as number) < 1) return null;

  const nextIndex = input.nextIndex;
  if (!Number.isInteger(nextIndex)) return null;
  if ((nextIndex as number) < 0 || (nextIndex as number) > (planLength as number)) return null;

  const savedAt = asString(input.savedAt);
  const saved = Date.parse(savedAt);
  if (Number.isNaN(saved)) return null;

  const age = now.getTime() - saved;
  // A record from the future is a clock change or a hand-edit, not a harvest.
  if (age < 0 || age > PROGRESS_MAX_AGE_DAYS * 86_400_000) return null;

  return {
    runId,
    nextIndex: nextIndex as number,
    planLength: planLength as number,
    savedAt,
  };
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Digits only, at most six. A pincode is never anything else. */
function asPincode(value: unknown): string {
  return asString(value).replace(/\D/g, "").slice(0, 6);
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim() !== "" && !out.includes(item)) out.push(item);
  }
  return out;
}

// ── storage ─────────────────────────────────────────────────
//
// localStorage throws outright in some privacy modes, so every access is
// guarded. A failure degrades to "the page forgets", never to a crash.

function readJson(key: string): unknown {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable or full — the page still works, it just forgets */
  }
}

function removeKey(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function readDraft(): DiscoveryDraft {
  return sanitizeDraft(readJson(DRAFT_KEY));
}

export function writeDraft(draft: DiscoveryDraft): void {
  writeJson(DRAFT_KEY, draft);
}

export function clearDraft(): void {
  removeKey(DRAFT_KEY);
}

export function readProgress(): DiscoveryProgress | null {
  return sanitizeProgress(readJson(PROGRESS_KEY));
}

export function writeProgress(progress: DiscoveryProgress): void {
  writeJson(PROGRESS_KEY, progress);
}

export function clearProgress(): void {
  removeKey(PROGRESS_KEY);
}
