# Troubleshooting — symptom, cause, what to say

Only symptoms that have been **reproduced or traced to their cause** are listed. Each entry says
what to tell the customer and how to tell the real cause from the lookalikes.

Nothing here is guesswork. Where a cause is unconfirmed it says so.

Last reviewed **2026-10-27**, against a production build on tenant 001288.

---

## "It says Access Denied, but I'm the owner / an admin"

**This was fixed on 2026-10-27** (commit `9b0a358`). A permission gate now knows the difference
between "no" and "I don't know yet", so the false refusal no longer appears.

**If a customer still reports it**, the first question is which version they are on. On anything
built before 27 October it was F-005: the guard asked "do they have the right?" before the answer
existed and showed Access Denied for about five seconds.

**What to say:**

1. "Reload the page." On a current build this should not recur at all.
2. Still denied? **Look at the bottom-left of the menu.** If it shows their real name and
   company, it is a genuine missing right — grant it at **Team → Employee Roles**.
3. If it still says "Company" and "User", their **session has expired** — sign out, sign in.

**The quick test that separates all three:** the sidebar. Real name = loaded. Placeholder = not
loaded or expired.

⚠️ **The same root cause still bites in two other places** — see the next two entries. The fix
covered gates that *show* a refusal, not gates that *redirect* or lists that load once.

---

## "I opened the form and all the dropdowns are empty"

**Cause: the form was opened by its URL rather than by its button.** Reproduced 2026-10-27,
F-012.

On **Add Task** (`/tasks/new`) reached by a typed URL, a bookmark, a refresh or a **task
notification**, every list on the form stays empty for the life of the page — no customers, no
leads, no products, nothing to link the task to — and **Assigned To shows a long code instead of
a name**.

**What to say:** "Go to the Tasks list first and click **New Task** there, rather than opening
the link directly." The same form then fills in correctly.

**How to confirm it is this and not a rights problem:** a rights problem refuses the whole page.
This one shows the whole form — it is just empty.

---

## "It won't let me open Add Product"

**Cause: the same loading race, in a gate that redirects.** Reproduced 2026-10-27, F-013.

Typing `/products/new`, or refreshing it, throws the user back to the Products list — **even the
account owner**.

**What to say:** "Open **Products** and click **New Product**." That works every time.

**Do not** start granting permissions for this. The user already has the right; the page asked
before the answer arrived.

---

## "Broadcasts won't open — it says the page couldn't load"

**Cause: a genuine crash.** Reproduced twice on 2026-10-27, F-016.

`/broadcasts` fails for **every** account that can reach it. The page shows "This page couldn't
load — Reload to try again, or go back", and reloading does not help.

**What to say:** "That's a fault on our side, not your account. I've logged it." Do not ask them
to clear their cache or try another browser — it will fail there too.

**Creating a broadcast still works** at `/broadcasts/new` (WhatsApp → Broadcasts → New, or the
New Broadcast button on the WhatsApp Dashboard). Only the list screen is broken.

---

## "My data has disappeared" / "the list is empty"

Four different causes, in the order they are worth checking:

| Check | Cause | Fix |
| --- | --- | --- |
| Does the sidebar show their real name and company? | If not — **still loading, or session expired**. A list queried without an account shows "Total: 0 records" (verified: Products read 0 while 25 active products existed) | Wait, refresh, or sign in again |
| Is there a **Record Status** filter set to Active? | Lists default to **Active**, so anything deactivated is hidden | Change the filter, or check Manage Column |
| On **My Activity**, is Status set to **Undone**? | That is the default — completed activity is hidden | Set Status to All |
| On a **report**, what is the period? | Reports open on a default period, and **they are not all the same** — Product Summary opens on *Today*, Customer Outstanding on *Last 365 days*, the other ten on *This Month* | The screen says it: *"Try a wider period — there may be records outside these dates."* |

**One list looks broken when it is merely empty:** Location Tracking → Visits prints no heading
and no "No data found" line, so there is nothing on the screen at all (F-010). An empty Visits
list is not a failure.

---

## "The report shows a number at the top but no rows underneath"

**Cause: the tiles and the table are not counting the same records.** Reproduced on
`/reports/tasks`, 2026-10-27, F-008.

The tiles read "# task 2 · # overdue 2" while the table under them said *No records found* for
the period. The records exist — they are dated outside the period, so the rows are filtered and
the tiles are not.

**What to say:** "Widen the date range at the top and the rows will appear." Then check the tile
figure again — it should now agree.

**Known on Task Reports.** Whether the other reports do the same is **unconfirmed** (Q-008) —
they all read 0 on the test tenant, so it could not be ruled out. Do not promise either way.

---

## "The customer's details are all showing dashes"

**Cause: a duplicated block on the customer page, not missing data.** Reproduced 2026-10-27,
F-014.

On a customer's page, **Customer Details** and **Address & Location** show the real values. An
**Other Details** block further down repeats thirteen of the same fields — Company Name, Contact
Person, Phone, Email, City, State, Country, Pincode and the rest — every one showing `—`.

**What to say:** "Scroll back up — your data is there, in the blocks above. The lower block is a
display fault and we've logged it." Nothing has been lost.

---

## "I clicked the link and it just put me on the dashboard"

**Cause: a plan or module gate.** Confirmed in the browser on 2026-10-23 — the app redirects
silently, with no message (F-001).

| Reason | How to confirm | Fix |
| --- | --- | --- |
| The **module is switched off** | Settings → Organization Settings | Switch the module on (if the plan allows it) |
| The **plan does not include that line** | Subscription shows the plan | Only a plan change fixes it |

Verified examples: `/schemes` bounced because the `scheme` module is off; `/service/assets`
bounced because the FSM line is not part of a legacy `Enterprise` plan.

**Say:** "That screen isn't switched on for your account" — then check which of the two it is
before promising anything.

**One lookalike that is not a gate:** `/products/new` also bounces to a list, for the entirely
different reason in F-013 above. If the user has a plan that includes products, it is that.

---

## "The menu item is missing for one user but not another"

Three independent causes. Nothing on screen distinguishes them, so check in this order:

1. **Role right** — the menu hides a row when the user lacks its permission. Check **Team →
   Employee Roles**, which is where the app's own error messages send people.
2. **Module toggle** — Settings → Organization Settings. Switched off hides it for *everyone*.
3. **Plan line** — Subscription. Not bought hides it for everyone, and no setting overrides it.

**Quick discriminator:** if it is missing for *every* user, it is 2 or 3. If it is missing for
*one* user, it is 1.

See N-001 in [known-issues.md](known-issues.md) for why these look identical in the code too.

---

## "The field staff app isn't recording their location"

Go to **Location Tracking → Tracking Health**. The screen was built for exactly this call and
carries a **"Likely issue"** column that names the cause per agent.

It also explains its own numbers: *Expected* is how many locations the app should have recorded
(time on duty ÷ the configured interval); *Regular* is how many it actually did. Turn on the
GPS off, Switched off, Mock and Accuracy columns through **Manage Columns** for detail.

Tiles at the top split the team into **Needs Attention**, **Tracking Normally**, **On Duty** and
**Not Punched In** — check "Not Punched In" first, since an agent who never started a shift is
not a tracking fault.

**Clicking an agent** opens their day in detail, and for the commonest case it answers the call
outright: *"No shift on this day — this agent didn't punch in, so no location was expected."*

---

## "Settings → Document Templates opens the wrong page"

**Cause: a broken link, not a missing feature.** Reproduced 2026-10-27, F-011.

`/settings/document-templates` lands on the **Overview** panel — the module toggles — instead of
Document Templates.

**What to say:** "Open **Settings** and pick Template from the list on the left, rather than
using that link." Then log it; the link itself needs a one-word fix.

---

## "Import says this module is coming soon"

**Check the spelling of the address first.** The import module keys are **plural** —
`/import/contacts`, `/import/products`, `/import/leads` — while custom fields use the
**singular** (`/custom-fields/contact`).

A singular import URL does not show an error. It shows *"This module import is coming soon"*,
which reads exactly like a feature that has not been built (N-005).

**Then** check the Import hub itself: ten of the eleven importers read **AVAILABLE** — Customers,
Products, Product Categories, Product Units, Leads, Outstanding, Tasks, Territories, Opening
Stock and Price Lists. Only **Orders** reads "SOON".

---

## "An announcement is still showing / has stopped showing"

**Status and Expiry are different things.** A row can read **Status = Active** and
**Expiry = Expired** at the same time: Active means the record is not deleted, not that it is
currently displayed. Check the Expiry Date column.

---

## "I can't find the Tasks screen"

There is **no menu entry for it** (F-002). The Tasks list works fully at `/tasks`, reached by
typing the URL or by opening a task notification from the bell. The menu's "My Activity" is a
different screen — an activity feed, not the task list.

⚠️ If they then click **New Task** from that typed URL, see the empty-dropdowns entry above.

---

## "The Getting Started page shows words like lead_count"

**Confirmed, and still open.** Reproduced in the browser on a production build on 2026-10-27,
F-007. Six tiles on the onboarding health panel print the raw database key instead of a label:
`lead_count`, `deal_count`, `quotation_count`, `product_count`, `price_list_count`,
`order_count`.

**What to say:** "Those are internal names for Leads, Deals, Quotations, Products, Price Lists
and Orders — the counts beside them are correct." It is cosmetic; nothing is miscounted.

---

## "It says Subscription Expired and nobody can get in"

**Cause: the subscription lapsed.** The whole portal is replaced by one card reading *"Your
subscription to the CRM has expired. Please renew it or contact support to restore access to your
workspace."*

An account counts as expired when its status says so **or** the expiry date has simply passed.
**There is no grace period.**

**What to say first, because it is the thing they are afraid of:** *"Nothing has been deleted.
Access is switched off, not your data — it all comes back the moment the subscription is
renewed."*

Then renew it. The Sign-out button on that card is there so a user who also belongs to another
account is not trapped.

**They did not see it coming?** The warning only appears within **15 days** of expiry. That is
intended, not a missed notice.

---

## "I can't add another employee"

**Cause: the seat limit.** The message is literal:

> *"your user/employee limit has reached. Reach us to increase user limit."*

**Their own admin cannot raise it — only we can.** It is enforced on the server, both when adding
an employee and when someone redeems an invitation, so there is no way around it from the UI.

Check the current position on **Subscription**: "You have created 21 out of 25 allowed users".

**Before selling them more seats, ask whether someone has left.** A departed employee who was
never deactivated is still holding a seat.

---

## "He paid, but the outstanding hasn't changed"

Four things decide whether a payment reduces a balance. Check them in this order:

1. **Is the payment approved?** Which payment statuses count as "received" is configurable per
   account — on many accounts a payment sitting in Pending reduces nothing.
2. **Is it verified?** Once a verified amount exists it wins over what the rep entered. Not yet
   verified means "unknown", not zero.
3. **Is it against the right customer?** A payment whose customer was removed settles nothing at
   all.
4. **Which order did it settle?** **Payments settle oldest-first** — opening balance first, then
   orders by date. The money has very likely gone against an older invoice than the one they are
   looking at.

**And check the order's own status:** only orders in the statuses the account treats as debt are
counted at all. A Cancelled or Rejected order owes nothing.

---

## "I deleted it by mistake"

**Almost certainly recoverable.** Records are soft-deleted: the row becomes **Inactive** rather
than disappearing, and the list only hides it because the Record Status filter defaults to Active.

**What to tell them:**

1. Clear the **Record Status** filter so Inactive rows appear.
2. In that row's Action column there is a **Re-activate** button (a circular arrow) where Delete
   normally sits.
3. Several lists also offer Re-activate as a bulk action, for a batch.

**A bad import is reversible as a unit too** — every run is recorded and can be undone.

---

## "How do I reset a password?"

- **The user does it themselves**: *Forgot password?* on the sign-in screen emails them a reset
  link. This is the route to point people at.
- **An admin sets the first password** when creating the employee — it is a field on the Add
  Employee form.
- **There is no password field on the employee edit form**, so an admin cannot simply retype it
  later.

---

## "How long do you keep our data? Is it safe?"

A fair question from a prospect, and there is a published answer at
**ozzo.co.in/privacy#retention**:

| Data | Kept |
| --- | --- |
| Business data — orders, payments, customers, attendance | While the account is active |
| Tracking data — GPS points | 365 days, then reduced to a daily summary |
| Technical logs | 90 days |

**Two things worth saying out loud:**

- The deletion job runs from a **closed list** of tables. Business data is pinned off that list,
  and a test enforces it — deleting from orders or payments would corrupt outstanding balances.
- **GPS points are only removed once the day's summary has been written successfully**, so a
  day's distance can never be lost to a failed roll-up.

---

## Still unexplained — do not promise a cause

| Symptom | Status |
| --- | --- |
| Anything on the **Android app** | Nothing mobile has been verified in this project |
| Anything a **non-owner** sees | Every screen so far was checked as the account owner |
| A report whose tiles disagree with its rows, other than Task Reports | Q-008 — could not be ruled out on a tenant with no data |
| Another screen that bounces the user during the loading window | Q-009 — no sweep has been done for gates that redirect |

**Resolved since the last review:** blank pages at `/custom-fields`, `/team` and
`/location-tracking/track-report` were a dev-server artefact. All three redirect correctly on a
real build (Q-007, closed 2026-10-27).
