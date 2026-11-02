# Customisation Proposal

**Prepared by:** OZZO (Xitij Infoway)
**Date:** 2 November 2026
**For:** *(client name)* — account *(to be created)*
**Status:** For your review. Nothing is built yet.

---

## 1. What this document is

You asked for two things that OZZO does not do today:

1. **Two extra order statuses** — *In Transit* and *Hold* — with a reason that the
   mobile user must give when putting an order on Hold.
2. **A DMS portal** — a separate website where your distributors log in, see the orders
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

## 3. The DMS portal

A separate website for your distributors, at its own address. A distributor who logs in
sees only their own business. They never see your CRM, your other distributors, your
salesmen, your costs or your other customers.

### 3.1 How a distributor gets in

You create the login. In **Settings -> Distributors** you add a distributor, set their user
ID and password, and press Save. Nothing is sent anywhere until you choose to share it
with them.

To stop working with a distributor you switch their access **off**. They can no longer log
in. Their past orders, dispatches and payments stay exactly where they are — nothing is
deleted, and your reports keep showing the full history.

When you switch a distributor off, OZZO shows you the dealers that were mapped to them and
asks **which distributor they move to**. One screen, one choice, done — so no dealer is
ever left without a distributor.

### 3.2 How dealers are mapped to distributors

Through **beats**, which you already use.

You assign a beat (route) to a distributor. Every dealer on that beat becomes that
distributor's dealer. Assign *150 Feet Ring Road* and *Kalawad Road* to Distributor A and
those dealers are A's; assign *Amin Marg* to Distributor B and that dealer is B's.

This means you manage the mapping in one place you already maintain, and adding a new
dealer to a beat automatically puts them with the right distributor.

### 3.3 What the distributor sees

| Screen | What is on it |
|--------|---------------|
| **Dashboard** | Orders waiting, orders in transit, orders on hold, today's deliveries, outstanding |
| **Orders** | Every order from their dealers, with status, value and date. Search, filter, print |
| **Create Dispatch** | Pick an order, pick the items and quantities, create the dispatch |
| **Deliveries** | Dispatches grouped by delivery boy, with what was delivered and what was held |
| **Payments** | What each dealer has paid and what is outstanding |
| **My Dealers** | The dealers on their beats, with address and phone |

A distributor marks an order **In Transit** when it leaves their godown.

### 3.4 The delivery boy

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

### 3.5 What you see

Everything. Every order, every dispatch, every delivery, every hold and every payment made
in the DMS appears in your own OZZO account, in the same lists and reports you use today,
with the distributor's name as a column you can filter on.
