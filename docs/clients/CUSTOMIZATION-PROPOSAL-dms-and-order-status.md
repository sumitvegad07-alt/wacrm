# Customisation Proposal

**Prepared by:** OZZO (Xitij Infoway)
**Date:** 2 November 2026
**For:** *(client name)* — account *(to be created)*
**Status:** For your review. Nothing is built yet.

---

## 1. What this document is

You asked for three things that OZZO does not do today:

1. **Two extra order statuses** — *In Transit* and *Hold* — with a reason that the
   mobile user must give when putting an order on Hold.
2. **A Buying Status** that marks, by itself, which customers have ever placed an order
   and which never have.
3. **A DMS portal** — a separate website where your distributors log in, see the orders
   from their dealers, create dispatches, and send a delivery boy out with them.

Both will be built **for your account only**. They will not appear for any other OZZO
customer, and no other customer's behaviour changes because of them. Your account carries
its own settings; these features are switched on against your account and nobody else's.

This document says exactly what you get and how each screen behaves. Timelines and
commercial terms are covered separately.

---

## 2. Order statuses

### 2.1 Today

An OZZO order moves through a fixed list:

> Pending -> Approved -> Part Dispatch -> Dispatched -> Closed
> (plus Rejected and Cancelled)

### 2.2 What you get

Two new statuses, available only in your account:

| Status | Meaning | Where it is set |
|--------|---------|-----------------|
| **In Transit** | The goods have left and are on the way to the dealer | Web, and the DMS portal |
| **Hold** | The order is stopped for a stated reason | Web and mobile |

The list becomes:

> Pending -> Approved -> **Hold** -> Part Dispatch -> **In Transit** -> Dispatched -> Closed
> (plus Rejected and Cancelled)

### 2.3 The Hold reason

An order cannot go on Hold without a reason. The reason is **chosen from a list**, not
typed, so that your reports can count them.

You manage that list yourself, in **Settings -> Order Hold Reasons**, exactly the way you
already manage Expense Types and Task Types. You can add, rename and switch off a reason
at any time. A suggested starting list:

- Shop closed
- Customer not available
- Payment pending
- Credit limit crossed
- Stock not available
- Address not found
- Customer refused delivery
- Other

The reason is saved against the order with the date, the time and the person who set it.
It shows on the order, in the order's history, and in the Order report as a column you can
filter and export.

### 2.4 Who may set which status

Every status becomes a **separate right** you grant per role, in **Team -> Roles**:

| Right | Typical holder |
|-------|----------------|
| Approve order | Admin, Sales Manager |
| Reject order | Admin, Sales Manager |
| Cancel order | Admin |
| Put order on Hold | Admin, Sales Manager, Field Salesman |
| Release order from Hold | Admin, Sales Manager |
| Mark In Transit | Admin, Distributor |
| Mark Dispatched / Part Dispatch | Admin, Distributor |
| Close order | Admin |

**Admin holds every right by default.** A role without a right does not see that button at
all — it is not shown and then refused; it is simply not there.

A field salesman can therefore put an order on Hold with a reason, but cannot release it
again. That is deliberate: the person who stopped an order should not be the only person
who can restart it.

---

## 3. Buying Status — who has ever bought, answered by itself

### 3.1 The problem with Active / Inactive

Every OZZO module already has an **Active / Inactive** status. It answers *"is this record
still in use?"* — switch a customer to Inactive and they drop off lists, pickers and
reports. That is a filing question, and you need it to stay exactly as it is.

What you asked for is a completely different question:

> **Has this customer ever bought from us?**

Reusing Active / Inactive for that would break the first one. A dealer who has never
ordered is still a perfectly real, perfectly current customer — your rep is visiting them
every week precisely *because* they have not ordered yet. Marking them Inactive would hide
them from the very people whose job it is to open them.

So this is a **second, separate status**, with its own name.

### 3.2 The name

**Buying Status**, with two values:

| Value | Meaning |
|-------|---------|
| **Buyer** | Has placed at least one order, ever |
| **Yet to Buy** | Has never placed an order |

Why these words:

- **They cannot be confused with Active / Inactive.** Different word, different question.
- **"Yet to Buy" is an instruction, not a label.** A rep reading his customer list sees
  not a status but a job for today. "Inactive" tells him to ignore someone; "Yet to Buy"
  tells him to go and sell.
- **Both are two words a rep can say out loud.** "I have forty Yet to Buy in Kalawad Road"
  is a sentence that works in a morning meeting.

Two alternatives if you prefer them — the mechanism is identical either way:

| Instead of | Values | Suits |
|------------|--------|-------|
| **Billing Status** | Billed / Unbilled | The standard trade words. Right for an admin, drier for a rep |
| **Outlet Opening** | Opened / Not Opened | The usual FMCG phrase for a shop's first order |

### 3.3 How it is kept correct

**By itself.** Nobody has to remember anything.

- The moment a customer's **first order is saved**, their Buying Status becomes **Buyer**.
  Not that night, not on a report run — at that moment, for everyone looking.
- A customer with no orders is **Yet to Buy**.
- When this is switched on, OZZO reads your whole order history once and sets every
  existing customer correctly, so it is right from the first day rather than only for new
  business.
- A **cancelled or rejected order does not count** as a purchase. Only an order that
  actually went ahead makes someone a Buyer.

The customer record also stores **when they first bought**, so "Buyers opened this month"
is a number you can see and report on.

### 3.4 Changing it by hand

An admin or a sales rep with the right can set it manually. Sometimes you need to: an
order came in by phone and was billed outside OZZO, or a customer should be treated as a
Buyer for a reason the system cannot know.

When somebody sets it by hand, **that choice is respected and the automatic rule stops
overriding it for that customer**. The record shows *Set by Ramesh on 3 November* so the
next person knows why it does not match the orders. An admin can hand the customer back to
the automatic rule at any time with one click.

### 3.5 Where you see it

- A **column on the Customers list**, which you can filter, sort and export — so "show me
  every Yet to Buy in Rajkot" is three clicks.
- On the **customer's own page**, with the date of their first order.
- On the **mobile app**, so a rep walking a beat can see which shops he has never sold to.
- In **reports**, including a count of Buyers opened in a period.

---

## 4. The DMS portal

A separate website for your distributors, at its own address. A distributor who logs in
sees only their own business. They never see your CRM, your other distributors, your
salesmen, your costs or your other customers.

### 4.1 How a distributor gets in

**There is no separate Distributors screen, and nothing extra to maintain.** A distributor
is simply a customer whose Customer Level is *Distributor* — which is how you already
record them today.

Open that customer. Because their level is Distributor, the customer form shows one extra
block that no other customer has:

| Field | What it does |
|-------|--------------|
| **Portal login ID** | What they type to sign in |
| **Password** | Set here, changeable here |
| **Beats served** | Tick the beats this distributor supplies |
| **Portal access** | On or off |

Save, and they can log in. Nothing is sent anywhere until you choose to share the login
with them.

So a distributor is created in exactly the place you already create customers, in the same
one screen, and their mapping is set at the same moment.

To stop working with a distributor you switch **Portal access** off on their customer
record. They can no longer log in. Their past orders, dispatches and payments stay exactly
where they are — nothing is deleted, and your reports keep showing the full history.

When you switch access off, OZZO shows you the beats that distributor was serving and asks
**which distributor takes each one over**. One screen, one choice, done — so no dealer is
ever left without a distributor.

### 4.2 How dealers are mapped to distributors

**Through the beat, and nothing else.** There is no separate mapping list to keep in step.

The rule is one line:

> A dealer belongs to the distributor who serves the dealer's beat.

Assign *150 Feet Ring Road* and *Kalawad Road* to Distributor A, and every dealer on those
two beats is A's. Assign *Amin Marg* to Distributor B, and that dealer is B's. Add a new
dealer to a beat tomorrow and they are mapped the moment you save — nobody has to remember
a second step.

Open any dealer and their customer form shows one read-only line, **Supplied by:
Distributor A**, so you can always see the answer without going looking for it.

**Your salesmen's beats are not touched by this.** It is the same beat doing two jobs: your
salesman walks it to take orders, and the distributor supplies it. One list, maintained
once, and nothing about how your reps work changes.

### 4.3 What this does NOT change

Worth stating plainly, because it is the question you will be asked.

| Thing you use today | After this |
|---------------------|------------|
| Customer Level (Distributor / Dealer) | Unchanged. Still decides whether an order is primary or secondary |
| Your beats and beat plans | Unchanged. Same beats, same planner, same approvals |
| How your salesmen take orders | Unchanged |
| Price lists, schemes, credit limits | Unchanged |
| Your existing customer screens | Unchanged, except the extra block on a Distributor |

Nothing you do today is replaced. One question that OZZO could not answer before — *which
distributor serves this dealer?* — now has an answer, and the beat already knew it.

### 4.4 What the distributor sees

| Screen | What is on it |
|--------|---------------|
| **Dashboard** | Orders waiting, orders in transit, orders on hold, today's deliveries, outstanding |
| **Orders** | Every order from their dealers, with status, value and date. Search, filter, print |
| **Create Dispatch** | Pick an order, pick the items and quantities, create the dispatch |
| **Deliveries** | Dispatches grouped by delivery boy, with what was delivered and what was held |
| **Payments** | What each dealer has paid and what is outstanding |
| **My Dealers** | The dealers on their beats, with address and phone |

A distributor marks an order **In Transit** when it leaves their godown.

### 4.5 The delivery boy

The delivery boy works in the **OZZO mobile app** — the same app your salesmen already
use. He signs in with his own login and the app opens on his delivery list. He sees
nothing else: no customers list, no orders, no reports. Only his deliveries.

He sees:

1. **His deliveries for today**, ordered **nearest first** from where he is standing.
   After he finishes a stop the list re-orders from his new position, so the next one is
   always the closest remaining stop.
2. **Every dealer under his distributor**, so he can look one up even when no delivery is
   assigned to it.

At each stop he does one of two things:

- **Delivered** — the order is marked done, with the date, time and his location. He can
  attach a photo.
- **Hold** — he picks a reason from the same list you manage in section 2.3, and the order
  goes to Hold. The distributor and you both see it immediately.

Everything he does is visible to the distributor and to you, with the time and the place
it happened.

Because it is the app and not a web page, three things work that could not work in a
browser:

| | In the app | In a browser |
|---|---|---|
| Location while the screen is off or he is on a call | Yes | No |
| Working with no signal, syncing later | Yes | No |
| Staying signed in all day | Yes | Loses the session |

A delivery boy spends his day in lifts, basements and godowns. Offline is not a
nice-to-have for him; it is the difference between the app working and the app being
abandoned by the second week.

### 4.6 What you see

Everything. Every order, every dispatch, every delivery, every hold and every payment made
in the DMS appears in your own OZZO account, in the same lists and reports you use today,
with the distributor's name as a column you can filter on.
