# Support rehearsal — 27 October 2026

Stage E. Twenty-two real support questions were put to this knowledge base and answered **from it
alone** — no reading of the code while answering. The point was not to score well. It was to find
out what a support person holding only these documents could not say.

**Result: 10 answered, 6 half-answered, 6 not answered at all.** Twelve gaps, all now fixed.

---

## How it was run

1. Twenty-two questions written first, before looking anything up — the mix a founder actually
   gets: commercial, access, money, field, setup, and the awkward ones.
2. Each answered by searching **only** `docs/ozzo-knowledge/`. If the answer was not in these
   files, it counted as a miss even where the answer was obvious from the code.
3. Every miss researched afterwards, in the code and the database.
4. The knowledge base corrected.

**The discipline that made it worth doing** was refusing to answer from what I already knew. A
question I could answer from memory but not from the documents is a question the documents fail —
and the documents are the thing being built.

---

## The scorecard

### Answered cleanly — 10

| # | Question | Where the answer was |
| --- | --- | --- |
| 4 | "My sales rep can't log in to the web portal" | Gate 0 — access matrix |
| 5 | "I made an HR role, can they see orders?" | Gate 4 — access matrix |
| 7 | "My rep gave 20% but the order shows 15%" | Pricing sequence, `min_price`, discount-over-price-list |
| 8 | "Why is my sales report lower than my order report?" | Sales means dispatched, not ordered |
| 10 | "My rep's location isn't tracking" | Tracking Health and its "Likely issue" column |
| 11 | "My rep can't punch out" | Punch-out fencing — the guidance was already there |
| 12 | "The visit shows as not productive" | Productive means it produced an order |
| 13 | "Where do I switch Stock on?" | Catalogue Settings, not Organization Settings |
| 14 | "I imported customers and territories are blank" | The backfill helper |
| 21 | "Can I change how my invoice looks?" | Document templates — with F-011 flagged |

### Half-answered — 6

| # | Question | What was missing |
| --- | --- | --- |
| 2 | "Can I add 5 more users?" | The limit was documented; **what happens when it is reached, and who can raise it, was not** |
| 6 | "Stop one employee seeing another's customers" | The scoping *model* was there; the steps to set it were not |
| 9 | "He paid but the outstanding is unchanged" | The formula was there; **the four rules that decide whether a payment counts were not** |
| 15 | "Sunday off for everyone except the Delhi team" | Holiday lists are per employee — but not how to create a second one and assign it |
| 17 | "I deleted a customer by mistake" | Soft delete was mentioned in passing; **recovery was never explained** |
| 20 | "Our dates are a day out" | "Dates are account-local" — but not where the time zone lives |

### Not answered at all — 6

| # | Question | Verdict |
| --- | --- | --- |
| 1 | "What happens to my data if I don't renew?" | **Silent.** The commonest commercial fear, and the knowledge base said nothing |
| 3 | "Can I move from CRM to CRM+SFA mid-term?" | **Silent** on who does it and what happens to data and modules |
| 16 | "An employee left — how do I remove them?" | **Silent**, and the real behaviour is surprising |
| 18 | "Can I get all my data out?" | **Silent** |
| 19 | "How do I reset someone's password?" | **Silent** |
| 22 | "How long do you keep our data?" | **Silent** — despite a published policy and an implementation |

---

## What the misses had in common

Not one of them was about a screen. **Every single miss was about the account's life** — renewal,
seats, people joining and leaving, deletion and recovery, data custody — or about a rule that
lives behind a number rather than in front of it.

The knowledge base had been built by walking the UI, so it knew the UI. It did not know what
happens when a customer stops paying, because that is not a screen anyone walks.

**That is the lesson for Stage F:** a video that shows every screen can still leave out everything
a customer worries about.

---

## What was fixed

### `feature-catalogue.md` — a new "Account lifecycle" section

Covering, with the exact on-screen wording where it exists:

- **Expiry** — the whole portal is replaced by one card; there is no grace period; **nothing is
  deleted**; warnings appear only within 15 days.
- **Seats** — the limit is enforced on the server in two places, the message is literal, and only
  we can raise it.
- **Plan changes** — modules are re-clamped to the new plan; four modules still need switching on
  by hand after an upgrade; on a downgrade the screens go and the data stays.
- **Employees leaving** — deactivate, do not remove; and what removal actually does, which is
  create them a fresh empty account and move their profile to it.
- **Deleting and recovering** — records are soft-deleted; clear the Record Status filter and use
  Re-activate.
- **Getting data out** — per list, per report, and the fact that Export CSV exports the whole
  filtered set rather than the visible page.
- **Passwords** — admin sets the first one, the user resets it themselves after that.
- **Retention** — the published figures and the two safeguards behind them.
- **Time zone** — account-level, IANA, and **with no screen to change it**.

### `feature-catalogue.md` — the Payments section

The four rules that decide whether a payment reduces a balance: order status, payment status
(configurable per account), the verified amount winning over the collected one, and
**oldest-first allocation**.

### `troubleshooting.md` — six new symptoms, 15 → 21

"Subscription Expired", "I can't add another employee", "He paid but the outstanding hasn't
changed", "I deleted it by mistake", "How do I reset a password?", and "How long do you keep our
data?".

---

## Two product findings that came out of it

Neither is a defect, but both are things a customer will hit:

1. **The account time zone has no editor.** It is read from the account's settings and used for
   every day boundary, but no settings panel writes it. A customer outside the default zone
   cannot fix their own dates.
2. **There is no self-service account-wide export.** Per-list and per-report CSV exist; "give me
   everything" is a support request. Worth knowing before it is asked in a sales meeting.

---

## Still thin, and deliberately not papered over

Two how-to questions are still answered at the level of the model rather than the steps, because
the steps have not been walked in a browser:

- **Setting a data scope for one employee** (question 6) — the rules are documented in
  `access-control-matrix.md`; the click path in the roles editor is not.
- **Creating a second holiday list and assigning it to a team** (question 15) — the rule that
  holiday lists are per employee is documented; the click path is not.

Both need a pass through the relevant settings screens. They are recorded here rather than
guessed at.

---

## Running this again

Worth repeating after any significant addition, and worth doing with **questions written before
the lookup**, not after. The value is entirely in the misses — a rehearsal that scores well has
usually been written backwards from the documents.
