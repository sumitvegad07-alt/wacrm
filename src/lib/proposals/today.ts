// ============================================================
// Today, as the founder's calendar sees it.
//
// Vercel runs in UTC, so `new Date().toISOString().slice(0,10)` dates anything
// created after 18:30 IST to yesterday — the same class of bug that once put
// "0 visits" on the DSR. The proposal date is a human date on a document, so it
// is resolved in Asia/Kolkata explicitly.
// ============================================================

/** yyyy-mm-dd in Asia/Kolkata. `en-CA` formats in exactly that order. */
export function todayInIndia(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
