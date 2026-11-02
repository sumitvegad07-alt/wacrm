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

This document says exactly what you get, how each screen behaves, what is **not**
included, and how long it takes. Please read section 7 — there are a few decisions we
need from you before we start.

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

The delivery boy opens the **same portal on his phone's browser**. He signs in with his own
login, created by the distributor.

He sees:

1. **His deliveries for today**, ordered **nearest first** from where he is standing. After
   he finishes the first stop the list re-orders from his new position, so the next one is
   always the closest remaining stop.
2. **Every dealer under his distributor**, so he can look one up even when no delivery is
   assigned to it.

At each stop he does one of two things:

- **Delivered** — the order is marked done, with the date, time and his location.
- **Hold** — he picks a reason from the same list you manage in section 2.3, and the order
  goes to Hold. The distributor and you both see it immediately.

Everything he does is visible to the distributor and to you, with the time and place it
happened.

> **Please note:** nearest-first ordering needs the phone's location. A browser can read
> location, but only while the page is open — it cannot track in the background and it does
> not work without a signal. If you need background tracking or offline working for
> delivery boys, that needs a mobile app, which is **not** part of this proposal. See
> section 7.

### 3.5 What you see

Everything. Every order, every dispatch, every delivery, every hold and every payment made
in the DMS appears in your own OZZO account, in the same lists and reports you use today,
with the distributor's name as a column you can filter on.

---

## 4. What is **not** included

Being plain about this now avoids a difficult conversation later.

| Not included | Why, and what it would take |
|--------------|-----------------------------|
| A mobile **app** for the DMS | You asked for a web portal only. An app is separate work |
| Background location tracking of delivery boys | Needs an app (see above) |
| Offline working in the portal | Needs an app |
| Distributor **stock** and auto-replenishment | Tracking what each distributor holds is a large module on its own. Tell us if you want it and we will quote it |
| Distributor **claims** (damage, scheme, freight, rate difference) | Standard in large DMS products, and a module in its own right |
| Accounting sync (Tally / Busy / Marg) | Quoted separately when you need it |
| E-way bill or transporter integration | Not in scope |
| A printed delivery challan book | The existing OZZO dispatch print is used |

---

## 5. How it will be delivered

| Phase | What lands | Working days |
|-------|-----------|--------------|
| **1. Order statuses** | In Transit, Hold, hold-reason master, per-role rights, reports | 12 |
| **2. Distributor access** | Distributor logins, portal shell, beat-to-distributor mapping, switch-off and reassign | 8 |
| **3. Dealer orders and dispatch** | Orders list, create dispatch, In Transit | 8 |
| **4. Delivery** | Delivery boy logins, assignment, nearest-first list, Delivered / Hold with reason | 13 |
| **5. Orders, payments and your oversight** | Order placement in the portal, sales and purchase orders, payments, your reports | 17 |
| | **Total** | **58 working days — about 12 weeks** |

Each phase is shown to you when it is finished. You can use phases 1 to 3 while 4 and 5
are still being built.

---

## 6. What we need from you

- A short session with the person who will actually run the distributor portal.
- Your starting list of hold reasons.
- One real distributor and two or three real dealers to test with.
- A decision on each point in section 7.

---

## 7. Decisions we need before starting

1. **Does the distributor hold stock in OZZO?** That is, do you want OZZO to know how much
   of each product each distributor is holding, and to reduce it as they dispatch? This is
   the single biggest question in this document — it roughly doubles phase 5.
2. **Purchase orders.** Does the distributor raise a purchase order **on you** through the
   portal, which you then approve and bill? Or do you push stock to them and the portal
   only records what arrived?
3. **Payments — how many ledgers?** Is it (a) dealer pays distributor, and (b) distributor
   pays you — two separate accounts to keep? Or only one of those?
4. **Can a dealer belong to two distributors?** Today a dealer belongs to one beat. If you
   need the same dealer served by two distributors (say, different product ranges), say so
   now — it changes how the mapping is built.
5. **Delivery boy — browser or app?** Section 3.4 explains the limits of the browser.
6. **Hold and dispatch.** When an order is on Hold, should it be blocked from being
   dispatched at all, or only flagged?
7. **Who releases a Hold?** Section 2.4 proposes Admin and Sales Manager. Confirm, or tell
   us who.
8. **Prices in the portal.** Should a distributor see the dealer's selling price, their own
   buying price, or both?

---

## 8. Commercial terms

*(To be filled in: the one-time customisation charge, the monthly or annual charge for the
DMS portal, the per-distributor-login charge if any, and the support terms.)*

---

*This proposal is valid for 30 days from the date above. Anything agreed outside it —
added screens, added reports, added integrations — is quoted separately before work
starts.*
