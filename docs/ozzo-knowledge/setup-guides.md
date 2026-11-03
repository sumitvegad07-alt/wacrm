# Setting up a new account — the order, and why it is that order

What to tell a new customer to do first, second and third, and which things break when they are
done out of order.

**Label:** VERIFIED IN CODE and, for the Getting Started wizard, VERIFIED IN BROWSER
(2026-10-27, tenant 001288).

---

## Start with Getting Started

The product already has the answer built in: **Getting Started** (`/getting-started`) is a
configured, account-aware checklist, not a static page. It knows which plan the account is on,
counts what they already have, and scores them.

Thirteen steps, as seen on a CRM + SFA account:

| # | Step | Est. |
| --- | --- | --- |
| 1 | Set up your territories | 4 min |
| 2 | Choose how you assign customers | 2 min |
| 3 | Create roles | 3 min |
| 4 | Add your employees | 5 min |
| 5 | Get the team on the mobile app | 3 min |
| 6 | Record your first activity | 3 min |
| 7 | Capture your first lead | 4 min |
| 8 | Create your first deal | 4 min |
| 9 | Send your first quotation | 4 min |
| 10 | Add your products | 5 min |
| 11 | Set up pricing | 3 min |
| 12 | Record your first order | 5 min |
| 13 | See your live data | 2 min |

About 47 minutes of real work. **Point customers at this screen rather than talking them through
setup** — then use the rest of this file for the questions it raises.

⚠️ Six of its health tiles currently print raw database names like `lead_count` (F-007). Tell
the customer what they mean; the counts themselves are right.

---

## The dependency order, and what breaks if you skip ahead

Setup is not a free-for-all. Some things must exist before others can be created properly.

```
Territories ──► Employees ──► Customers
     │              │             │
     │              └──► Routes   └──► Leads, Visits, Orders
     │
     └──► Area-based assignment

Tax slabs ──► Products ──► Price lists ──► Orders
                  │
                  └──► Stock, Schemes
```

### 1. Territories first

**Why first:** every customer, lead and employee is placed in the geography tree, and a database
trigger stamps that geography onto the record on every write — including import.

**If you skip it:** customers import with their country/state/city typed in free text and no
territory link. It is recoverable — the Territory screen has a **backfill helper** that matches
by name and flags what it cannot match — but it is work you did not need to do.

**Decide at the same time:** whether customers are assigned **by area** or **directly to a
person** (step 2). The choice changes which screens appear — the Settings → Territory link only
shows in area mode.

### 2. Roles before employees

**Why:** an employee is created *with* a role, and the role carries both the permission set and —
critically — **whether that person can use the web portal, the mobile app, or both.**

**Create the roles you actually need before adding people**, or you will edit twenty employees
later. A new role starts with both web and mobile access on, so a field-only role needs web
access switched off deliberately.

**The usual shape of a field-sales account:** one or two admins on the web, everyone else
**mobile only**.

### 3. Employees, then get them on the app

Adding an employee creates their **login** — email and password are part of the form. Then step 5
sends them the Play Store link.

**Each employee also gets:**
- a **Holiday List**, which decides *their* weekly offs and holidays — this is per employee, not
  per company, and the attendance screen judges them against it
- optionally a **territory assignment**
- optionally a **manager**, if Reporting Hierarchy is on

### 4. Tax slabs before products

A product has **no tax rate of its own** — it points at a tax slab. Create the slabs first
(Catalogue Settings) or every product needs editing afterwards.

While you are there, decide:
- **Multi Unit** — on, if they sell in boxes and pieces. Price and stock stay in the base unit.
- **HSN codes and GST** — separate toggles from tax slabs.

### 5. Products, then pricing

Order matters because a price list points at products.

- **Catalogue price** is the default for everyone.
- A **price list** adds a blanket discount and/or per-product overrides, and is attached to
  customers.
- **`min_price`** on a product is a hard floor no discount may cross.
- **Discounting on top of a price list is off by default** — switch
  *allow discount over price list* on in Catalogue Settings if the customer wants it.

### 6. Customers last

By now territories exist, employees exist to own them, and price lists exist to attach. A
customer imported at this point is complete.

**Import rather than typing:** the importer handles 696 customers as easily as six, and runs the
same territory trigger.

---

## The decisions to make before the account is in use

These are hard to change later, so raise them during setup.

| Decision | Where | Why it is hard to undo |
| --- | --- | --- |
| **Area or direct assignment** | Getting Started step 2 | Changes which screens exist and how customers are routed |
| **Reporting Hierarchy on/off** | Organization Settings | **Switching it ON makes data disappear for reps** — scoping starts applying. Ships off |
| **Duplicate rules** | Organization Settings | Turning one on "starts rejecting saves that used to be allowed". Phone number is always on and cannot be switched off |
| **Customer hierarchy** | Organization Settings | Changes how every order is classified (primary/secondary) |
| **Multi Unit** | Organization Settings | Changes how price and stock are read |
| **Tax inclusive or exclusive** | Order Settings | Stored per line, so old orders keep their basis — the account can end up with a mix |
| **Geo-fencing** | Organization Settings | Starts blocking visit check-ins away from the customer |
| **Which modules are on** | Organization Settings | Switching one off hides its screens for everyone at once |

---

## The modules that ship switched OFF

A customer on the right plan can still be missing a feature, because four modules do not switch
themselves on:

| Module | Switch it on at | Why it ships off |
| --- | --- | --- |
| **Stock** | **Catalogue Settings** | Opt-in |
| **Scheme** | **Catalogue Settings** | Opt-in |
| **Route** (beat planning) | Organization Settings | Optional — free-visit mode is the default |
| **Reporting Hierarchy** | Organization Settings | Ships off; changes visibility when enabled |

**Stock and Schemes are not in Organization Settings**, which is where everybody looks first.

---

## Setting up attendance and tracking

For an account that will track field staff:

1. **Set the shift and grace period** — the Attendance screen prints them on the page, so
   whatever is configured is what the customer sees being measured.
2. **Add Attendance Locations** if punches should be fenced to a place. Per location, choose
   whether it fences **Punch In only**, Punch Out only, or both.
   - **Choose "Punch In only" for field staff who finish in the field** — fencing punch-out traps
     a rep who ends the day elsewhere.
   - The phone's GPS accuracy is added to the radius automatically, up to 100 m.
3. **Know that shift times never gate tracking.** If a rep is punched in, they are tracked — at
   any hour. A customer expecting tracking to stop at 7 pm is wrong about the design.
4. **Geo-fencing for visits is a separate switch** from attendance fencing.

---

## Master data a new account starts with

New accounts are created with sensible defaults already in place — statuses, lead sources,
activity types, a default holiday list, payment types, and so on. **The customer does not start
from an empty system**, and they should be told that, because the instinct is to create
everything by hand.

What they genuinely must supply: territories, roles, employees, products, tax slabs, and their
customers.

---

## Setting up WhatsApp

Worth separating out, because it has an external dependency nobody expects.

1. Switch the **WhatsApp module** on (needs the CRM line).
2. Connect the account at **Settings → WhatsApp**.
3. **Create a message template and submit it to Meta for approval.**

**Nothing can be sent until Meta approves a template.** Broadcasts and business-event automations
are both blocked until then, and both screens say so. This is the answer to most "WhatsApp isn't
working" calls during onboarding — it is a waiting period, not a fault.

---

## A sanity checklist before handing an account over

- [ ] Territories created, and the assignment mode chosen
- [ ] Roles created, **with web/mobile access set deliberately per role**
- [ ] Employees added, each with a holiday list
- [ ] The team has the Play Store link and can sign in
- [ ] Tax slabs, then products, then price lists
- [ ] Customers imported, with territories resolving
- [ ] The modules they paid for are switched **on** — check Stock and Scheme in Catalogue Settings
- [ ] Shift, grace and attendance locations configured if they track
- [ ] A WhatsApp template submitted, if they bought WhatsApp
- [ ] Getting Started shows a healthy score
