# The OZZO video dictionary

Every video OZZO should have, in the order to make them, across all three audiences and in both
languages.

**Status: ALL 37 SCRIPTED, 2026-10-28. Nothing has been filmed yet.**

> Every film in this catalogue now has a Hinglish script written to the **OZZO Video Script
> Master Standard** — a VO-ready `narration-hinglish.txt` plus a `SCRIPT.md` carrying the brief,
> the shot list, the accuracy notes and a quality check, one folder per film under
> `docs/marketing/video/`. The index, with measured word counts and runtimes, the consolidated
> list of captures that do not exist yet, and the demo-tenant states each film needs, is
> `docs/marketing/video/SCRIPTS-INDEX.md`.
>
> **24,332 words of narration, about 2 hours 49 minutes of finished voice-over.** Awaiting the
> founder's approval; no voice-over has been generated.

This is a catalogue, not a wish list. Each entry says who it is for, how long it should run, what
it shows, and what has to exist before it can be recorded. The content comes from the knowledge
base in this folder, so every claim in every script is already verified.

---

## The three tracks

| Track | Audience | Purpose | Films | Typical length |
| --- | --- | --- | --- | --- |
| **A — Sell** | Prospects | Win the deal | 8 | 90 s – 3 min |
| **B — Start** | New customers, first week | Set up without calling you | 11 | 2 – 5 min |
| **C — Use** | Existing customers | Answer the call before it happens | 18 | 60 – 150 s |

**37 films, each in English and Hindi — 74 cuts.** That is a programme, not a weekend. The
priority order at the end says which eight to make first.

---

## One rule across all 37 films: no FSM

**Founder ruling, 2026-10-28 — keep FSM out. Three lines.**

OZZO has four product lines in the code. Only **three are sold**: CRM, Workforce and Sales. FSM
is built to Phase 1, no tenant owns it, and its prices are marked in the code as not approved for
publishing.

So **no customer-facing film names it** — not the opener, not the pricing film, not an aside. A
sales film that advertises something a prospect cannot buy earns a question you do not want to
answer, and the viewer remembers the gap rather than the product.

When FSM goes on sale: A1 needs one new block of about eight seconds, A5 needs its line table
extended, and a Track A film of its own becomes worth making. Until then it does not exist on
screen.

---

## How these get made

Two production methods already exist in this repository, and each suits a different job.

### Method 1 — the animation pipeline (for Track A)

`docs/marketing/video/` holds a working, proven pipeline: an HTML page animated and **locked to a
measured voiceover**, rendered to frames and encoded to 1080p30. The 2:17 SFA intro film was made
this way, in English and Hindi, with the Hindi cut driven by a time-warp table so the animation
lands on the Hindi words rather than the English ones.

**Use it for anything explaining an idea** — the problem, the pricing, the security story. No
real data appears, so nothing has to be cleared, and it looks like a product film rather than a
screen recording.

### Method 2 — screen recording (for Tracks B and C)

A how-to video has to show the actual product, or it is not a how-to. These are **screen
recordings of the real app on a demo tenant**, with a voiceover and title cards over the top.

**I cannot record the screen.** Automated capture is blocked in this project by design. The
division of labour that works:

| Me | You |
| --- | --- |
| Script, word for word, in both languages | Record the screen while following the shot list |
| Shot list: every click, in order | Record the voiceover (or approve a synthetic one) |
| Title cards, lower thirds, end cards as HTML | Final assembly |
| Check every claim against the knowledge base | |

**Record on a demo tenant, never on a customer account.** Four demo tenants exist, one per plan
shape, with a daily job that keeps "today" populated — which is exactly what a how-to video
needs. Never film account 001001.

### Both languages, one script

The proven method: write once, record two voiceovers, render two cuts. Hindi runs roughly 10–15%
longer than English, which the existing time-warp tooling already handles. **Script in English,
but write it knowing it will be spoken in Hindi** — short sentences, no idioms, no wordplay.

---

## Before anything is filmed

**Eight defects are live, and four of them are on camera-facing screens.** Filming them bakes a
bug into a permanent asset.

| Status | Defect | Why it matters to a video |
| --- | --- | --- |
| ✅ **FIXED** `372802b` | F-016 Broadcasts crashed | Any WhatsApp film reaches this screen. It could not be filmed at all |
| ✅ **FIXED** `8341d46` | F-007 Getting Started showed `lead_count` | The onboarding track opens on this screen — the first thing a new customer sees |
| ✅ **FIXED** `6d28edc` | F-014 Customer detail repeated empty fields | Visible in any customer-detail shot. Thirteen dashes looks like data loss |
| Still open | F-012 Add Task by URL | Only if a film links to the form directly; **filming from the list is safe** |
| Still open | F-013 Add Product by URL | Same — film from the Products list and it works |

**The three camera-facing defects were fixed on 2026-10-27 and re-verified in a browser.** The
two that remain are safe to film around, because both work when reached the way a customer
reaches them.

The low-severity three (F-009, F-010, F-015) are cosmetic and can be filmed around.

**Also settle before filming:** the four screens whose layout notes predate the 26 October design
system have not been re-read. Film is permanent; check the screen before pointing a camera at it.

---

# Track A — Sell

For prospects. Made with the animation pipeline. No real customer data.

### A1 · What OZZO is, in 90 seconds
**90 s · all audiences · the one you send first**

> **SCRIPTED 2026-10-27** — English and Hindi, with the shot list, at
> `docs/marketing/video/A1-what-ozzo-is/`. 195 spoken words, 13 named screenshots (all checked
> present), every claim traced to a file in this folder. **Written with three lines, not four:**
> FSM is built but sold to nobody, so advertising it would promise what a prospect cannot buy.
> Not yet built — no voiceover, no animation, no render.

The whole product in one breath: a web dashboard for the office, an Android app for the field,
one system. The three lines you can buy today, named once, plainly. Ends on "live on Google Play".

*Why it exists:* the 2:17 intro film is SFA-specific and assumes the problem is already felt.
This one is the universal opener.

### A2 · The CRM line
**2 min** · Leads → customers → deals → quotations, and WhatsApp as the thread running through
them. The pitch: *stop losing enquiries in a WhatsApp group.*

### A3 · The Workforce line (WFA)
**2 min** · Attendance, punch in/out with geo-fencing, visits with check-in and check-out
locations, expenses, live tracking. The pitch: *know where your team is, and what they did,
without phoning them.*

### A4 · The Sales line (SFA)
**2 min** · Orders priced correctly on the phone, dispatch and part delivery, payments and
outstanding, stock, beat planning. The pitch: *the order is right before it leaves the shop.*

*Note:* the existing 2:17 film covers this ground. **Re-cut it rather than remaking it** — it is
a good film, and its Hindi version already exists.

### A5 · How the plans fit together
**2 min** · The three lines, how they combine, and the one rule everyone gets wrong: **SFA
includes Workforce.** A customer buying Sales already has attendance, visits and expenses, and
should not be sold them twice. The quarterly / half-yearly / yearly terms.

No per-user figures on screen — pricing stays out of public material, and a number on film dates
the moment it changes.

*Why it exists:* this conversation happens in every sales call and is answered inconsistently.

### A6 · "We already use WhatsApp and Excel"
**2 min** · The objection film. Not a feature list — a day in the life. An order typed into
WhatsApp at 4pm, retyped into Excel at 8pm, with a wrong price nobody catches until the invoice.

### A7 · Is our data safe?
**90 s** · The question that stalls deals at the last step. Where the data lives, that each
company's data is separated at the database level, how long things are kept — business data while
you are a customer, GPS for a year, logs for ninety days — and that you can export your lists
whenever you want.

*Everything in this script is already verified in `feature-catalogue.md`.*

### A8 · OZZO on the phone
**90 s** · The field app alone: punch in, see today's customers, take an order offline, collect a
payment, punch out. The pitch: *it works where there is no signal.*

---

# Track B — Start

For a new customer's first week. Screen recordings on a demo tenant. These follow the real
Getting Started order, because that order exists for a reason.

### B1 · Your first hour
**4 min** · The map of the whole setup, and **why the order matters**: territories before
customers, roles before employees, tax slabs before products. Ends by handing over to the
Getting Started screen.

### B2 · Set up your territories
**3 min** · Build the geography tree, import it, and the backfill helper for customers whose
addresses were typed before the tree existed. Covers the area-versus-direct decision.

### B3 · Roles — and who gets the web, who gets the app
**4 min** · **The most important film in this track.** Create a role, grant rights, and —
critically — the **Login Access** section: web portal, mobile app, or both. The normal shape of a
field-sales account is one or two admins on the web and everyone else mobile-only.

Shows what a blocked user actually sees, so an admin recognises it when their rep calls.

### B4 · Add your employees and get them on the app
**3 min** · Create an employee with their login, assign the role and the holiday list, then send
the Play Store link. Covers the seat limit and what the message means when it appears.

### B5 · Your products, units and tax
**4 min** · Tax slabs first, then categories, then units, then products. Multi Unit explained with
the box-of-twelve example. The `min_price` floor, and what it stops.

### B6 · Pricing: price lists and discounts
**3 min** · Catalogue price, blanket discount, per-product override, and the resolution order.
Then the switch that decides whether a salesman may discount **on top of** a price list — off by
default, and the reason reps say "the app won't let me".

### B7 · Bring your customers in
**3 min** · The import flow — upload, map, preview, confirm — the fact that nothing is written
until confirm, and that a run can be undone. Duplicate rules, including the phone-number rule
that is always on.

### B8 · Attendance, shifts and punch locations
**4 min** · Set the shift and grace, add an attendance location with a radius, and choose what it
fences. **Includes the warning that matters:** fence punch-out and a rep who finishes in the
field cannot punch out. Choose Punch In only.

### B9 · Switch on what you paid for
**2 min** · The four modules that ship **off** — Route, Reporting Hierarchy, Scheme, Stock — and
where each lives. **Stock and Scheme are in Catalogue Settings, not Organization Settings**,
which is where everyone looks first.

### B10 · Your first order, end to end
**5 min** · Customer → order → approve → dispatch → payment. One continuous journey, so a new
admin sees how the modules connect. The order locks when it ships, and that is explained as it
happens rather than discovered later.

### B11 · Reading your dashboard
**3 min** · What each section means, why it changes with the plan, and the two numbers people
misread: **order value is not sales value**, and **pipeline value is not weighted value**.

---

# Track C — Use

For customers who already have it. Short, one job each, named as the question people actually
ask. **These are the ones that reduce support calls.**

## C1–C12 · How do I…?

| # | Film | Length | Covers |
| --- | --- | --- | --- |
| **C1** | Take an order | 2 min | Customer, lines, discount, save; how the price is built |
| **C2** | Send a part delivery | 2 min | Dispatch against an order, remaining quantity, and how the status moves to Part Dispatch on its own |
| **C3** | Record a payment and approve it | 2 min | Entry, proof photo, approval, verified amount |
| **C4** | Claim an expense, and approve one | 90 s | Both sides, including why approval is a separate right |
| **C5** | Apply for leave, and approve it | 90 s | Including the holiday list deciding which days count |
| **C6** | Plan a beat | 2.5 min | Build a route, approve it, assign it on the planner — and that reps run it on the phone |
| **C7** | A visit, start to finish | 2 min | **Filmed on the phone.** Check in, record, check out; geo-fencing; what "productive" means |
| **C8** | Quote, then revise the quote | 2 min | Versions, and showing a customer what was quoted before |
| **C9** | Import without breaking anything | 2.5 min | Preview before confirm, import history, and undo |
| **C10** | Build the report you actually want | 2.5 min | Filters, dimensions, saving a default view, export |
| **C11** | Print and share a document | 90 s | A4 and A5, printing the list you are looking at, document templates |
| **C12** | Add a field that OZZO doesn't have | 2 min | Custom fields, sections, and showing it in the table |

## C13–C18 · Why is it doing that?

Each of these answers a call that currently reaches you. Scripts come straight from
`troubleshooting.md`.

| # | Film | Length | The answer it gives |
| --- | --- | --- | --- |
| **C13** | "Why can't my rep see this?" | 2.5 min | The gates, in order: which app they can sign in to, the plan, the module toggle, the role. **Probably the single highest-value film in the whole dictionary.** ✅ **SCRIPTED 2026-10-28** — EN + HI + shot list at `docs/marketing/video/C13-why-cant-my-rep-see-this/`. Needs journey **S4 walked first**, and four captures that do not exist yet — above all the "Web access disabled" card |
| **C14** | "My report is empty" | 90 s | Default periods differ per report; Product Summary opens on *today* |
| **C15** | "He paid, the outstanding didn't change" | 2 min | Approval status, verified amount, and **oldest-first allocation** |
| **C16** | "The app isn't tracking him" | 2 min | Tracking Health and its Likely issue column; check *Not Punched In* first |
| **C17** | "I deleted it by mistake" | 60 s | Clear the Record Status filter, press Re-activate |
| **C18** | "It won't let my rep give that discount" | 90 s | `min_price`, and discounting over a price list being off |

---

## What to make first

Eight films, in this order. Each is chosen because it either closes deals or stops calls.

| Order | Film | Why this one |
| --- | --- | --- |
| 1 | **A1** What OZZO is, in 90 seconds | You have nothing short to send a prospect |
| 2 | **C13** Why can't my rep see this? | The most common support call, and the hardest to explain by phone |
| 3 | **B3** Roles, web and app access | Prevents C13 from ever being needed |
| 4 | **B10** Your first order, end to end | The journey every new customer wants to see |
| 5 | **C1** Take an order | The single most-performed task in the product |
| 6 | **A5** How the plans fit together | Stops the pricing conversation being improvised |
| 7 | **C16** The app isn't tracking him | High call volume, and the answer is one screen |
| 8 | **A7** Is our data safe? | Unblocks deals that stall at the last step |

**Four of the eight are sales or pricing films, four are support films.** That split is
deliberate: the first group brings customers in, the second stops them calling once they arrive.

---

## What has to be true before filming starts

- [x] **F-016, F-007 and F-014 fixed** — done 2026-10-27, re-verified in the browser
- [ ] **A demo tenant chosen and checked**, with data that looks like a real business on the day
      of filming
- [ ] **The journeys walked once** — see [demo-scenarios.md](demo-scenarios.md). None has been
      walked yet
- [ ] **Screen recording settled**: who records, at what resolution, with the viewport fixed so
      cuts match
- [ ] **A voice decided** — recorded or synthetic, and the same voice across the series in each
      language
- [ ] **The visual furniture built once** — title card, lower third, end card, in OZZO's palette,
      reused by all 37

---

## How this gets kept honest

Every script claim is traceable to a file in this folder. Before a script is recorded, check it
against:

| Script content | Check against |
| --- | --- |
| What a screen shows | [ui-inventory.md](ui-inventory.md) |
| Why a number is what it is | [feature-catalogue.md](feature-catalogue.md) |
| Who can see a feature | [access-control-matrix.md](access-control-matrix.md) |
| The steps in a workflow | [workflow-guides.md](workflow-guides.md) |
| An answer to a problem | [troubleshooting.md](troubleshooting.md) |
| Whether a screen is currently broken | [known-issues.md](known-issues.md) |

**A film is permanent in a way a document is not.** A wrong sentence in a document is edited; a
wrong sentence in a video is re-recorded, re-rendered and re-uploaded in two languages. Check
twice.
