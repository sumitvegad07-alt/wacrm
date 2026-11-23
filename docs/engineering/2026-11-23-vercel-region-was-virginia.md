# Every OZZO app was running in Virginia

**2026-11-23.** All three production apps — the CRM (`app.ozzo.co.in`), the
Partner Portal (`partner.ozzo.co.in`) and the DMS (`dms.ozzo.co.in`) — were
executing their server code in **`iad1`, Washington, D.C.**, while the database
has been in **Mumbai (`ap-south-1`)** since the Mumbai migration.

Nobody chose Virginia. `iad1` is the default region for a new Vercel project,
and none of the three projects had ever overridden it.

## How it was found

The founder reported that "everything that has data takes too long" in the
Partner Portal. The obvious suspects — RLS policies, missing indexes, N+1
queries in the screens — were all wrong. The measurement that settled it, taken
from his own browser against production:

| Measured                                    | Time       |
| ------------------------------------------- | ---------- |
| Partner dashboard page render (**reads no data at all**) | 1,797 ms |
| Partner `GET /api/proposals`                | 2,526 ms   |
| Partner `GET /api/renewals`                 | 2,495 ms   |
| CRM `GET /api/account`                      | 2,745 ms   |
| CRM `GET /api/account/members`              | 2,924 ms   |
| DMS page render                             | 1,448 ms   |
| **A query from the browser straight to Mumbai** | **110 ms** |

The last row is the whole diagnosis. The database was never slow: a browser in
India reaches it in about 110 ms. What was slow was *the server in Virginia*
asking Mumbai — roughly 230 ms each way — three or four times before a byte of
HTML existed.

The partner dashboard row is the proof in a single line. That page does nothing
but ask "who are you?" and render a welcome heading. It took 1.8 seconds.

## Why some screens felt twice as bad

Partner Proposals, Invoices and Renewals load through `/api/...` routes rather
than querying PostgREST from the browser. Those screens paid the Virginia
round trip **twice** — once for the server render, and again for the `fetch`
the browser makes after hydrating. Opening Proposals was over four seconds.

## The fix

`"regions": ["bom1"]` in each project's `vercel.json`. One region is permitted
on every Vercel plan, so this is safe on Hobby and Pro alike.

## How to check this on any future app

`x-vercel-id` on any response names the regions it passed through:

- `bom1::…` — handled at the Mumbai edge (static, or middleware).
- `bom1::iad1::…` — **the edge took it in Mumbai and shipped the work to
  Virginia.** This is the bug.
- `bom1::bom1::…` — correct.

Check it on a route that actually invokes a function; a cached or
middleware-redirected response only ever shows the edge region.
