// ============================================================
// Google Places (New) Text Search client. Server-only: the API key never leaves
// the server, because a key in the browser is a key anyone can spend.
//
// Two facts shape this file:
//
//   1. Phone number and website are Enterprise-tier fields, so EVERY call here
//      is billed at the Enterprise rate and counts against the 7,000/month India
//      free allowance. `pagesFetched` is therefore the number that matters, not
//      the number of businesses returned.
//
//   2. One request returns at most 20 results and Google refuses to paginate
//      past 3 pages. 60 is the hard ceiling per search phrase — which is why the
//      caller searches small places (industrial areas) rather than whole states.
// ============================================================

import { MAX_PAGES, PLACES_FIELD_MASK, RESULTS_PER_PAGE, type PlacesResult } from "./discovery-query";

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

export interface SearchTextResult {
  results: PlacesResult[];
  /** Billable calls this search cost: one per page actually requested. */
  pagesFetched: number;
  /** Set when Google refused; `results` then holds whatever earlier pages gave. */
  error: string | null;
  /** True when Google itself says the quota is exhausted — the brake worked. */
  quotaExhausted: boolean;
}

export function placesApiKey(): string | null {
  return process.env.GOOGLE_PLACES_API_KEY?.trim() || null;
}

/**
 * Runs one text search, following `nextPageToken` up to `maxPages`.
 *
 * `maxPages` is passed in rather than fixed so the caller can shorten the last
 * search of the day instead of overshooting the cap by two pages.
 */
export async function searchText(
  apiKey: string,
  textQuery: string,
  maxPages: number = MAX_PAGES,
): Promise<SearchTextResult> {
  const results: PlacesResult[] = [];
  let pageToken: string | undefined;
  let pagesFetched = 0;

  const pageLimit = Math.max(1, Math.min(maxPages, MAX_PAGES));

  for (let page = 0; page < pageLimit; page++) {
    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": PLACES_FIELD_MASK,
        },
        body: JSON.stringify({
          textQuery,
          languageCode: "en",
          regionCode: "IN",
          pageSize: RESULTS_PER_PAGE,
          ...(pageToken ? { pageToken } : {}),
        }),
        // A hung request would stall the whole harvest; fail the search instead.
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      return {
        results,
        // The request was attempted, so assume Google counted it.
        pagesFetched: pagesFetched + 1,
        error: err instanceof Error ? err.message : "Network error calling Google Places",
        quotaExhausted: false,
      };
    }

    pagesFetched++;

    if (!response.ok) {
      const detail = await readError(response);
      // 429 means a quota ceiling was hit. That is the designed outcome of the
      // Cloud-console cap, not a bug — the caller stops rather than retrying.
      const quotaExhausted = response.status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(detail);
      return {
        results,
        pagesFetched,
        error: `Google Places ${response.status}: ${detail}`,
        quotaExhausted,
      };
    }

    const payload = (await response.json().catch(() => ({}))) as {
      places?: PlacesResult[];
      nextPageToken?: string;
    };

    for (const place of payload.places ?? []) results.push(place);

    pageToken = payload.nextPageToken;
    // No token means Google has nothing more for this phrase — stop rather than
    // spend another call discovering the same thing.
    if (!pageToken) break;
  }

  return { results, pagesFetched, error: null, quotaExhausted: false };
}

async function readError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (!text) return response.statusText || "unknown error";
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string; status?: string } };
    return parsed.error?.message ?? parsed.error?.status ?? text.slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}
