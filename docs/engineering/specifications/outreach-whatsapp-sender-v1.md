# Outreach — WhatsApp Sender (WhatsApp Web) — V1

**Status:** Approved, not built · 2026-10-17
**Owner:** Founder-only tool. Not a product line, not tenant-facing, no mobile, never resold.
**Route:** `/admin/revenue/outreach` · **API:** `/api/admin/revenue/outreach/*`
**Second slice of** [OZZO Revenue Engine](./ozzo-revenue-engine-r1.md), after
[Lead Discovery](./lead-discovery-google-places-v1.md).

## Why this exists

Lead Discovery harvests callable manufacturer and distributor numbers, ~20,000 of
them, and leaves them in a CSV to be worked by telephone. Telecalling 20,000
numbers is 5–6 months of somebody's life. A first touch on WhatsApp costs
seconds, and the ones who reply are the only ones worth ringing.

The reference product is **RocketSend.io** ($20/month, "unlimited"). It is worth
being precise about what it is, because it sets the ceiling on what this needs to
be: a **Chrome extension** that injects itself into `web.whatsapp.com` and drives
the founder's own logged-in session. There is no cloud service and no WhatsApp
API. Meta charges them nothing because *the user* is the sender. Their entire
feature set is: CSV merge fields, a configurable lag between messages,
auto-ignore invalid and blocked numbers, one attachment,
message-a-number-without-saving-it, an LLM call on the compose box, and a CSS
blur for screen sharing. No queue, no server, no inbox, no analytics, no
scheduling, no team seats.

So this is not a hard build. **Almost all of the value is in the throttle**, which
RocketSend does not have, and in being wired to `re_discovery_leads` so the list
never has to leave the portal as a file.

## The decision this design is built on

Both facts were put in front of the founder with the trade-offs, and he chose:

1. **Sending from the real OZZO business number**, not a disposable SIM.
2. **Laptop on, WhatsApp Web tab open.** Not a server.

Choice 2 follows from choice 1. A VPS holding a WhatsApp session on a datacenter
IP, messaging strangers, is the strongest ban signal there is; running inside his
own Chrome on his own home IP with his own real session is the quietest thing
that can send at all. Choice 1 is what makes every number in
§"Keeping the number alive" conservative rather than merely sensible.

### Known, accepted risks

- **WhatsApp's Terms of Service prohibit bulk and automated messaging.** The
  throttle makes a ban unlikely, not impossible, and the exposure is the business
  WhatsApp number, its chat history and its Meta Business account. **The founder
  was shown this and chose to proceed.**
- **This contradicts an approved spec.** Revenue Engine R1 §7.6 rules that "cold
  WhatsApp is a bad first touch… WhatsApp is a follow-up channel only," and
  planned `meta_whatsapp` as a templates-only R3 provider. **That ruling is
  overruled for this tool, deliberately and knowingly.** R1's reasoning was about
  the *WABA* — policy enforcement and quality rating on an official API number.
  This tool never touches the WABA: it drives the consumer WhatsApp Business app
  session instead. R1's conclusion still stands for `meta_whatsapp`, and §7.6
  should be read as applying to that provider, not to this one.
- **The Google Maps terms position is unchanged** from Lead Discovery: §3.2.3(a)
  prohibits using Maps data to build a telemarketing list, and that was already
  accepted when the harvest was built.

### The constraint that shapes everything

A phone number lives **either** on the consumer WhatsApp app (phone, WhatsApp
Web) **or** on the Meta Cloud API. Registering it for the Cloud API removes it
from WhatsApp Web, and there is no way to have both.

Production was checked on 2026-10-17: the single `whatsapp_config` row has
`status = 'connected'` but `registered_at` and `subscribed_apps_at` both null,
and `waba_id` equal to `phone_number_id` — i.e. a half-finished configuration
that was never registered for Cloud API sending. The business number is therefore
still an ordinary WhatsApp Business app number, and WhatsApp Web can drive it.

**If that number is ever registered on the Cloud API, this tool stops working
entirely.** That is not a bug to fix; the two are mutually exclusive. It is noted
here so that a future "let's finish the Cloud API setup" ticket does not silently
destroy this one.

## Architecture

Nothing is hosted. Three parts, and the division between them is the whole design.

| Part | Where | Owns |
|---|---|---|
| Portal page | Next.js, `requireFounder()` | Choosing leads, writing the message, watching progress |
| Database | Existing Supabase | The campaign, who to send to, who was sent to, who must never be |
| Chrome extension | Loaded unpacked in the founder's Chrome | Mechanics only: put this text on that number |

### D1 — Every policy decision is made on the server

The extension is a **dumb executor**. It does not know the daily cap, the send
window, the warm-up ramp, the gap between messages, the message template, or
which variant a recipient gets. It asks for work and is told either "send this
exact text to this exact number" or "nothing for you, come back in 240 seconds".

Three reasons, in order of importance:

1. **A bug in the extension cannot blast 20,000 messages.** The thing most likely
   to be wrong is the least-tested, least-reviewable code in the system — an
   unpacked extension that nobody but Chrome runs. It must not be the component
   holding the brakes.
2. **All of the maths becomes ordinary, testable TypeScript** in
   `src/lib/revenue/outreach-policy.ts`, tested the way `discovery-query.ts` is.
   Nothing that matters is verifiable only by loading an extension and watching.
3. **Reinstalling or reloading the extension loses nothing.** Counters kept in a
   service worker's memory do not survive Chrome's own idle eviction, which is
   measured in seconds, let alone a reload.

### D2 — The campaign lives in the database, not in the tab

Lead Discovery learned this twice: Chrome's Memory Saver discards a backgrounded
tab, and navigating the admin menu unmounts the page. Both silently killed a
harvest, and it cost a migration
(`20261010180000_revenue_discovery_background_runs`) to move the work off the
browser.

So progress here is a row per recipient with a status, not an index in React
state. Close the portal tab, crash Chrome, reboot — reopen and the campaign
carries on at recipient 437. **Only the WhatsApp Web tab must stay open**, because
that is where the session is; that is unavoidable and is stated in the UI.

### D3 — One recipient per HTTP call

The extension asks for exactly one recipient, sends it, reports the result, and
asks again. Not a batch.

At a 45–120 second gap, an HTTP round trip per message is free, and it buys: the
cap and window are re-checked before *every* send rather than once per batch; a
dropped connection or a closed laptop strands at most one message; and there is
no "claimed ten, sent three, crashed" state to reconcile. This is the same
instinct as Lead Discovery's D3, for the same reason.

### D4 — WA-JS, not simulated clicks and keystrokes

Sending goes through [`@wppconnect/wa-js`](https://github.com/wppconnect-team/wa-js)
(Apache-2.0, actively maintained), a bundle injected into the WhatsApp Web page
that exposes WhatsApp's own internal modules as a global `WPP`.

The alternative — find the message box in the DOM, type into it, click send — is
how most of these tools work, and it is why most of them are dangerous. CSS
selectors break every time WhatsApp ships a redesign, and the failure mode is not
an error: it is the right text in the wrong chat.

What we use:

| Call | For |
|---|---|
| `WPP.contact.queryWidExists(phone)` | Is this number on WhatsApp at all |
| `WPP.blocklist.isBlocked(wid)` | Has this person blocked us |
| `WPP.chat.sendTextMessage(wid, text, { createChat: true })` | Send, without saving a contact |
| `WPP.chat.sendFileMessage(wid, file, …)` | The one optional attachment |
| `window.WPP.isReady` | Do not touch anything before this |

**`queryExists` is deprecated and is deleted on 27/10/2026** — upstream says so in
the source. Use `queryWidExists`. A pinned copy of the bundle is vendored into the
extension rather than loaded from a CDN, so an upstream publish cannot change what
runs against the business number without a commit.

### D5 — A revocable bearer token, not the founder's session cookie

The extension's background service worker cannot borrow the logged-in session:
Supabase's auth cookies are `SameSite=Lax`, and a fetch from a
`chrome-extension://` origin is cross-site, so they are not sent. Nor should a
service-role key ever sit in an unpacked extension folder.

Instead: `re_outreach_agents`, one row per installed extension, holding a random
token. The founder mints it on the portal page, the value is shown **once**, and
he pastes it into the extension. Revoking the row stops the extension dead
without touching anything else. `last_seen_at` is stamped on every call, so the
page can show "extension last spoke 8 seconds ago" instead of leaving him
guessing why nothing is sending.

This is the same shape as `re_discovery_runs.worker_token` — a narrow,
individually revocable credential rather than a shared secret — except multi-use,
because the extension has to come back 80 times a day.

### D6 — Recipients snapshot the lead, they do not reference it

`re_discovery_leads` is purged after 90 days by design. A campaign at 80
messages/day runs for weeks, so pointing at those rows would mean a campaign that
works for a month and then starts failing on rows whose data has evaporated.

So `re_outreach_recipients` copies phone, name, city and industry at the moment
the campaign is created. `place_id` is carried too, for joining back to
`re_discovery_seen_places`, but nothing depends on the lead row still existing.

### D7 — Two permanent lists, which outlive every campaign

- **`re_outreach_sent_phones`** — every number ever messaged, forever, unique on
  the normalised phone. A later campaign for a different industry in the same
  district will re-find the same companies; this is what stops the same
  switchboard getting the same pitch twice. Exactly `re_discovery_seen_places`'
  job, one layer up.
- **`re_suppressions`** — do-not-contact. **Built with the name, columns and
  channel/reason vocabulary that Revenue Engine R1 §6.13 already specifies**, so
  that when the rest of R1 lands there is one do-not-contact list rather than two
  that disagree. Checked before every send.

**Both lists match on `normalisePhone()` from `discovery-query.ts`** — the
India-aware one that adds `91`, strips the trunk `0` and leaves 1800/1860/1600
toll-free numbers alone. Not `normalizePhone()` from `whatsapp/phone-utils.ts`,
which only strips non-digits. The distinction is not cosmetic: that function is
what wrote every `re_discovery_leads.phone` value, so matching on the other one
would compare `9180…` against `080…`, find nothing, and re-message people who
had already been messaged or had asked not to be. Same function in, same string
out, or the dedupe is decorative.

### D8 — The cap and the ramp belong to the number, not the campaign

It is the phone number that gets banned, not the campaign, so both throttles are
counted per **sending number** across everything it has ever sent — not per
campaign row. `daily_cap` lives on the campaign because that is where it is
edited, but it is applied as a ceiling on that number's total sends for the IST
day.

This matters for the one thing the founder is most likely to do: start on a spare
SIM, then switch Chrome profiles to the business number. If the ramp were keyed
on the campaign, the business number would inherit the SIM's warm-up history and
open at full speed on its first day — the exact opposite of what the ramp is for.
Keyed on `sender_phone`, a new number starts at 20 whatever the campaign has
already done.

The extension therefore reports its logged-in number on every call, and a
`sender_phone` that does not match the one the campaign has been sending from
pauses the campaign and asks for confirmation rather than quietly carrying on.

### D9 — Opt-out is honoured by hand, and the spec says so

The founder chose to track sent/failed only: the extension never reads anyone's
incoming messages. That is the right call — it is a much smaller build, and it
keeps the tool away from mirroring chats.

The consequence has to be stated rather than glossed: **nothing detects a reply,
so nothing can auto-honour "STOP".** The message still ends with an opt-out line,
because sending bulk messages with no way out is both rude and the fastest route
to being reported, which is the thing that actually gets numbers banned. But the
loop is closed manually: replies arrive on his phone as normal, and the portal has
a paste box that writes straight into `re_suppressions`.

If that turns out to be a chore, the fix is the deferred "flag who replied" phase,
not reading message text.

## Keeping the number alive

The defaults below are deliberately slower than the founder will want on day one.
They are set for the number his customers message him on.

| Guard | V1 behaviour |
|---|---|
| Gap between messages | Uniform random **45–120 s**. Never fixed — constant timing is the single most legible bot signature |
| Long break | After every 20 sends, **5–12 minutes** |
| Daily cap | Default **80**, founder-editable per campaign, enforced by counting `sent_at` in the current IST day |
| Warm-up ramp | Day 1 of a number's sending life: 20. Then +20/day until the cap. Keyed on the number, not the campaign |
| Send window | **10:00–18:30 IST, Mon–Fri**, via the account-timezone helpers, never `toISOString()` |
| Not-on-WhatsApp check | `queryWidExists` before every send. Google Maps rows include landlines; sending into the void is a strong spam signal. Marked `skipped_not_on_whatsapp`, never retried |
| Blocked check | `isBlocked` → `skipped_blocked`, never retried |
| Suppression check | Server-side, immediately before handing the recipient out — not at campaign creation, so a number added to `re_suppressions` mid-campaign is spared |
| Message variants | 2–4 wordings required; the **server** picks per recipient, round-robin by recipient id. 1,000 byte-identical messages is what fingerprinting looks for |
| Dead-man switch | 3 consecutive send failures, or WhatsApp Web reporting logged-out, pauses the campaign and surfaces the reason on the page |

At 80/day, 20,000 leads is **250 working days**. There is no safe way to make that
materially larger on one number, and a design that pretends otherwise is a design
for getting banned. The honest lever is message quality, not throughput.

**Recommended but not enforced:** run the first ~300 on a cheap spare SIM to find
out whether the message earns replies before pointing it at the number the
business depends on. V1 supports this with no extra code — the extension is bound
to whatever session the Chrome profile is logged into.

## The flow

1. `/admin/revenue/outreach` → **New campaign**.
2. Pick a discovery run; filter by state, district, industry, category.
3. The page reports the funnel before anything is created:
   *"1,240 matched · 180 already messaged · 12 suppressed · 1,048 to send."*
4. Write 2–4 message variants with `{name}`, `{city}`, `{industry}` merge fields.
   Optionally attach one image or PDF. The opt-out line is appended and cannot be
   removed.
5. **Test send** to up to 3 numbers typed by hand. These do not touch
   `re_outreach_sent_phones`.
6. Set the daily cap, press **Start**.
7. Open WhatsApp Web and leave the tab alone. The portal shows live counts, the
   current wait, and the last ten results.

## Database

Five tables. RLS enabled with **no policies** — platform-owner data, reachable
only through the service role after `requireFounder()` passes, exactly like
`re_discovery_*` and `retention_runs`.

#### re_outreach_campaigns

`id uuid pk` · `name text` · `variants text[]` (2–4, CHECK on length) ·
`attachment_path text` (Supabase Storage key, nullable) ·
`status text (draft|running|paused|done|stopped)` ·
`daily_cap int default 80` · `gap_min_sec int default 45` ·
`gap_max_sec int default 120` ·
`window_start time default '10:00'` · `window_end time default '18:30'` ·
`weekdays_only boolean default true` ·
`paused_reason text` · `owner_id uuid not null` · `created_at` / `updated_at`

#### re_outreach_recipients

`id bigserial pk` · `campaign_id uuid → campaigns on delete cascade` ·
`place_id text` · `phone text not null` (normalised, `91XXXXXXXXXX`) ·
`name` / `city` / `district` / `state` / `industry text` (snapshot — D6) ·
`status text (queued|in_flight|sent|failed|skipped_not_on_whatsapp|skipped_blocked|skipped_suppressed|skipped_already_sent)` ·
`variant_index int` · `rendered_text text` (what was actually sent, for disputes) ·
`is_test boolean not null default false` ·
`claimed_by uuid → agents` · `claimed_at timestamptz` · `sent_at timestamptz` ·
`attempts int default 0` · `error text` · `created_at`
· unique `(campaign_id, phone)`

`rendered_text` and `variant_index` are written by `/next` at the moment the row
is claimed, not at campaign creation — the variant has to be chosen after the
suppression and already-sent checks have decided the row is really going out.

#### re_outreach_sent_phones

`phone text primary key` · `first_sent_at timestamptz` · `campaign_id uuid` ·
`place_id text`. Permanent (D7).

#### re_outreach_agents

`id uuid pk` · `label text` · `token_hash text not null unique` ·
`sender_phone text` · `sender_first_sent_on date` ·
`last_seen_at timestamptz` · `revoked_at timestamptz` · `owner_id uuid` ·
`created_at`. The token is stored hashed and shown once (D5).

`sender_phone` is reported by the extension on every call — it is the number
WhatsApp Web is actually logged in as — and it is what the warm-up ramp and the
daily cap are counted against (D8). `sender_first_sent_on` is stamped on the
first successful send from that number and is the day the ramp counts from.

#### re_suppressions

Exactly R1 §6.13: `channel text (email|phone|whatsapp|domain|all)` ·
`value text` (normalised, unique with channel) ·
`reason text (opt_out|bounce|complaint|competitor|existing_customer|manual)` ·
`note text` · `created_by` · `created_at`.

### Claiming, and why it is one statement

`/next` must hand the same recipient to two agents never — a retried request, two
Chrome windows, a reloaded extension. So the claim is a single
`update … set status='in_flight' … where id = (select … where status='queued'
order by id limit 1 for update skip locked) returning *`, in an RPC
(`re_outreach_claim_next`), not a select-then-update from the route.
`for update skip locked` is what makes two concurrent callers get two different
rows instead of one row twice.

`in_flight` rows older than 15 minutes revert to `queued` — that is a laptop that
closed mid-send, and the cost of the rare double-send it risks is lower than the
cost of a recipient stuck for ever.

## API

All routes `requireFounder()` except the two the extension calls, which
authenticate by agent token (D5) and are rate-limited via the existing
`checkRateLimit`.

| Route | Who | Does |
|---|---|---|
| `POST /api/admin/revenue/outreach/preview` | Founder | The §Flow step-3 funnel counts. Writes nothing |
| `POST /api/admin/revenue/outreach/campaigns` | Founder | Create campaign + materialise recipients |
| `POST /api/admin/revenue/outreach/campaigns/[id]/state` | Founder | start / pause / stop |
| `GET /api/admin/revenue/outreach/campaigns/[id]` | Founder | Progress, last ten results, current wait |
| `POST /api/admin/revenue/outreach/suppress` | Founder | Paste numbers into `re_suppressions` (D9) |
| `POST /api/admin/revenue/outreach/agents` | Founder | Mint / revoke an extension token |
| `POST /api/admin/revenue/outreach/test-send` | Founder | Queue up to 3 hand-typed numbers for the next `/next` call |
| `POST /api/admin/revenue/outreach/next` | **Agent** | `{ recipient, wid, text, attachment_url? }` or `{ wait_seconds, reason }` |
| `POST /api/admin/revenue/outreach/result` | **Agent** | `sent` / `failed` / `skipped_*` / `logged_out`; writes `re_outreach_sent_phones` on success |

`/next` is where §"Keeping the number alive" is actually enforced: suppression,
already-sent, cap, window, warm-up, long break and gap are all evaluated there,
and the answer is either one rendered message or a number of seconds to sleep.

**Test sends go down the same path as everything else**, because a test that
takes a different route tests the wrong thing. `/test-send` writes ordinary
`re_outreach_recipients` rows flagged `is_test`, which jump the queue and are
exempt from the cap, the window and the already-sent list — but still go through
rendering, `queryWidExists` and the gap, so what the founder sees on his phone is
exactly what a prospect would get. They never write
`re_outreach_sent_phones`.

**The dead-man switch is counted on the server, in `/result`** — not in the
extension, per D1. Three consecutive non-skip failures on one campaign, or a
`logged_out` result, sets `status='paused'` and `paused_reason`, and the next
`/next` call returns a refusal rather than work. A `skipped_*` result is not a
failure and does not advance the counter; a successful send resets it to zero.

## The extension

`wacrm-web/extension/ozzo-sender/`, **excluded from `tsconfig.json` and the Next
build** so it cannot affect a Vercel deploy. Loaded unpacked via
`chrome://extensions` — not published to the Chrome Web Store, since it is for one
machine and publishing a bulk WhatsApp sender invites a review nobody needs.

| File | Job |
|---|---|
| `manifest.json` | MV3. `host_permissions`: `web.whatsapp.com`, `app.ozzo.co.in` |
| `vendor/wppconnect-wa.js` | Pinned WA-JS bundle (D4) |
| `content-whatsapp.js` | Injects WA-JS into the page's MAIN world, waits for `WPP.isReady`, bridges one send at a time |
| `background.js` | The loop: `/next` → send → `/result` → sleep `wait_seconds`. Holds the token. Holds no policy (D1) |
| `options.html` / `options.js` | Paste the agent token; shows the logged-in WhatsApp number |

The extension stores the token in `chrome.storage.local` and nothing else. It
reads no chat history and no contact list.

## Files

| File | Role |
|---|---|
| `src/lib/revenue/outreach-policy.ts` | Pure logic: gap, long break, warm-up, daily cap, send window, variant pick, merge-field render |
| `src/lib/revenue/outreach-policy.test.ts` | vitest, the way `discovery-query.test.ts` is |
| `src/lib/revenue/outreach-eligibility.ts` | Funnel counts and recipient materialisation from `re_discovery_leads` |
| `src/lib/revenue/outreach-agents.ts` | Token mint, hash, verify, `last_seen_at` |
| `src/app/api/admin/revenue/outreach/…` | The eight routes above |
| `src/app/(superadmin)/admin/revenue/outreach/` | Page + campaign client |
| `supabase/migrations/20261017100000_revenue_outreach.sql` | The five tables, the claim RPC, RLS on with no policies |
| `extension/ozzo-sender/` | The extension |

## Testing

Everything that can be wrong quietly is covered. Pure functions in
`outreach-policy.ts`, tested with vitest:

- the gap is inside `[gap_min, gap_max]` and is not the same twice in a row;
- the long break fires on the 20th send and not the 21st;
- warm-up on day 3 is 60, and never exceeds `daily_cap`;
- 18:29 IST is inside the window, 18:31 is not, Saturday never is, and none of it
  goes through `toISOString()`;
- the cap counts IST days, so 23:55 IST is not tomorrow;
- merge fields leave no `{placeholder}` behind when a lead's `city` is `''` —
  Google returns blanks constantly;
- variant rotation is even across a 1,000-row campaign;
- a `sender_phone` change resets the ramp to day 1 (D8).

There is no database test harness in this repo — vitest runs `environment: node`
and there is no `supabase/config.toml`, so no local stack. Rather than invent
one, eligibility is written as a **pure function over three fetched arrays**
(`selectEligible(leads, sentPhones, suppressions)`), so the rule that actually
matters is unit-tested like everything else:

- a suppressed or already-sent number is never returned, matched through
  `normalisePhone()` on both sides;
- a lead whose phone normalises to `''` is dropped rather than queued.

One thing genuinely cannot be tested here and is verified by hand instead,
because the alternative is pretending: **two concurrent `/next` calls must get
two different recipients.** The guarantee comes from `for update skip locked`
inside `re_outreach_claim_next`, and it is checked once, after the migration is
applied, by firing two requests at the same campaign simultaneously and
confirming two different recipient ids come back. Written down as a step in the
plan so it is not quietly skipped.

The extension itself is checked by hand, in this order, and **not** against the
business number: a test SIM → three numbers the founder owns → 20 real prospects
→ Start. The one thing no test can establish is whether WhatsApp objects, so the
first real campaign is deliberately small.

## Build order

| Phase | What | Verifiable alone |
|---|---|---|
| 1 | Migration, `outreach-policy.ts` + tests, `outreach-eligibility.ts`, preview + create routes, portal page | Yes — no extension exists yet |
| 2 | `re_outreach_agents`, token mint/revoke UI, extension skeleton, WA-JS injection, "connected as +91…" | Yes |
| 3 | `/next` + `/result`, the claim RPC, the background loop, test send | Yes — on numbers the founder owns |
| 4 | Warm-up ramp, dead-man switch, suppression paste box, resume-after-crash | Yes |

## Configuration

No new environment variables. Attachments use the existing Supabase Storage
bucket; the agent token is a database row (D5), not an env secret.

## Not in V1

Reading replies, flagging who replied, pulling reply text into the portal, and
auto-creating leads from repliers — all four were offered, and all four declined
in favour of shipping. "Flag who replied" is the next one worth building, and D8's
manual opt-out is the reason.

Also out: AI rewrite and AI reply (two to four hand-written variants beat a
generated one for a message sent 20,000 times), privacy blur, team seats, a
scheduling calendar, groups, charts beyond sent/failed counts, multiple
simultaneous campaigns, and any mobile surface.

**Explicitly never:** tenant-facing exposure, or resale. This tool breaks
WhatsApp's terms on the founder's own number by his own decision; shipping that
capability to customers is a different act with a different risk, and this
document is not authority for it.
