# Run this SQL — territory visibility, and moving a customer between routes

Two blocks. **Nothing in this batch works on the live site until both have been run.**

Open Supabase → SQL Editor → paste one file, Run, then the other. They are safe to run
twice.

| # | File | Fixes |
|---|------|-------|
| 1 | `supabase/migrations/20261102120000_contacts_leads_scope_and_area_visibility.sql` | Assigning a territory to a mobile user now actually shows them those customers |
| 2 | `supabase/migrations/20261102130000_route_customers_one_time_stop.sql` | The `uq_route_customers_one_active_route` error, and "keep this customer on the route one time only" |

---

## Block 1 — why a new mobile user saw no customers

You assigned a territory to a new mobile user and their Customers list stayed empty, so
their route had nothing to visit either. Assigning the same area to Dhaval worked.

Both layers were behaving, and they were cancelling each other out:

* **The database** said: this user may see a customer they **own**, **or** one inside an
  **area assigned to them**. That was right. I checked it on the live database — the new
  user's assignment did resolve to all 45 Rajkot territories.

* **The mobile app** then narrowed that again to *"customers whose owner is me or someone
  reporting to me"*, which it does whenever **Reporting Hierarchy** is on. Your account
  001001 has it on.

"Own only" **and** "own or my area" leaves **own only**. The new user owns nothing, so they
saw nothing. Dhaval saw customers because he owns them, not because of his territory.

So the area was being honoured by the database and then thrown away a moment later. No
amount of assigning territories could ever have fixed it.

### What changes

The database becomes the only place that decides, which is the rule the **web** app has
always followed — this is what finally makes web and mobile agree.

For that to lose nothing, the one thing the app filter did that the database did not —
letting a **manager** see their team's customers — moves into the database.

After this:

| Who | Sees |
|-----|------|
| Admin / owner | Everything, exactly as now |
| A rep with areas assigned | Their own customers **+ every customer in their areas** ← the fix |
| A manager ('team' scope) | Their own + their areas + **their team's** |
| A rep with no areas | Their own, exactly as now |

Assign **Rajkot** and the rep gets every customer in Rajkot *and* in every area under it.
Assign **150 Feet Ring Road** to Dhaval and **Amin Marg** to someone else and each sees
only their own area — which is what you asked for.

**Nothing that is visible today becomes invisible.** This block only ever widens.

---

## Block 2 — the red error on the Add Customers screen

```
duplicate key value violates unique constraint "uq_route_customers_one_active_route"
```

That is our own rule — **one customer belongs to one active route** — doing its job, and
then showing you its internal name. The dialog offered a blue **+ Add** on a customer the
database was always going to refuse.

### What changes

A customer already on another route now shows **"On: Kalawad Road"** and a **Move here**
button instead. Pressing it asks you two things, in your words:

1. *"This customer does not belong to this route. Do you still want to add them?"*
2. *"Keep them on this route always?"* — **Yes, always** moves them properly. **No, one
   time only** lets this route visit them on **one date** and leaves them on their own
   route.

That second option is what the SQL is for: a one-time stop sits **outside** the
one-active-route rule, which is the whole point — a customer parked on another route for
a day still belongs to their own route. On every other date the stop simply is not there.

It also updates `get_route_for`, the one function that answers "which route runs today",
so a one-time stop appears on its date and on no other.

---

## After running both

* Open a new mobile user's Customers list — the customers in their assigned areas are
  there. Their route works again.
* Open a route → Add Customers → a customer on another route reads **"On: <route>"**.

If Block 1 is run and Block 2 is not, customers come back but the route dialog still
shows the raw error. If Block 2 is run and Block 1 is not, routes behave but the mobile
customer list stays empty. **Run both.**
