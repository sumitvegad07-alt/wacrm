import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveRecipients, type RecipientConfig } from "./recipients";

// ------------------------------------------------------------
// Minimal Supabase stub: supports .from(t).select().eq().eq().maybeSingle()
// and counts queries so the "fetch each related record at most once" guarantee
// is actually asserted rather than assumed.
// ------------------------------------------------------------
interface Tables {
  contacts?: Record<string, unknown>[];
  profiles?: Record<string, unknown>[];
}

function fakeDb(tables: Tables) {
  const queryCount: Record<string, number> = {};

  const client = {
    from(table: string) {
      queryCount[table] = (queryCount[table] ?? 0) + 1;
      const rows = [...((tables[table as keyof Tables] as Record<string, unknown>[]) ?? [])];
      const filters: Array<[string, unknown]> = [];
      const builder = {
        select() {
          return builder;
        },
        eq(col: string, val: unknown) {
          filters.push([col, val]);
          return builder;
        },
        async maybeSingle() {
          const hit = rows.find((r) => filters.every(([c, v]) => r[c] === v));
          return { data: hit ?? null, error: null };
        },
      };
      return builder;
    },
  };

  return { client: client as unknown as SupabaseClient, queryCount };
}

const ACCOUNT = "acc-1";

const contacts = [
  {
    id: "ct-1",
    account_id: ACCOUNT,
    name: "Campus Grocery Mart",
    company: "Campus Grocery",
    phone: "+919876543204",
  },
  { id: "ct-nophone", account_id: ACCOUNT, name: "No Phone Ltd", company: null, phone: null },
  { id: "ct-badphone", account_id: ACCOUNT, name: "Bad Phone", company: null, phone: "12345" },
];

const profiles = [
  {
    id: "pr-rep",
    user_id: "u-rep",
    account_id: ACCOUNT,
    full_name: "Ramesh",
    phone: "+919000000011",
    manager_id: "pr-mgr",
  },
  {
    id: "pr-mgr",
    user_id: "u-mgr",
    account_id: ACCOUNT,
    full_name: "Priya",
    phone: "+919000000022",
    manager_id: null,
  },
  {
    id: "pr-nophone",
    user_id: "u-nophone",
    account_id: ACCOUNT,
    full_name: "Suresh",
    phone: null,
    manager_id: null,
  },
];

const cfg = (...types: RecipientConfig[]) => types;

describe("resolveRecipients — customer", () => {
  it("resolves the customer, preferring company as the display name", async () => {
    const { client } = fakeDb({ contacts, profiles });
    const out = await resolveRecipients(client, cfg({ type: "customer" }), {
      accountId: ACCOUNT,
      contactId: "ct-1",
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: "customer",
      key: "customer:ct-1",
      label: "Campus Grocery",
      phone: "919876543204",
      reachable: true,
      contactId: "ct-1",
    });
  });

  it("explains, rather than silently skipping, a customer with no phone", async () => {
    const { client } = fakeDb({ contacts, profiles });
    const out = await resolveRecipients(client, cfg({ type: "customer" }), {
      accountId: ACCOUNT,
      contactId: "ct-nophone",
    });
    expect(out[0].reachable).toBe(false);
    expect(out[0].reason).toMatch(/no phone number saved for No Phone Ltd/i);
  });

  it("rejects a number too short to be a phone number at all", async () => {
    const { client } = fakeDb({ contacts, profiles });
    const out = await resolveRecipients(client, cfg({ type: "customer" }), {
      accountId: ACCOUNT,
      contactId: "ct-badphone",
    });
    expect(out[0].reachable).toBe(false);
    expect(out[0].reason).toMatch(/not a usable WhatsApp number/i);
  });

  it("warns about a bare 10-digit number instead of silently letting Meta reject it", async () => {
    // 9 of 27 production customers are stored as plain 10-digit Indian mobiles.
    // isValidE164 accepts these, so without this warning the system would report
    // "reachable", then fail at send time with a cryptic Meta error.
    const { client } = fakeDb({
      contacts: [
        { id: "ct-nocc", account_id: ACCOUNT, name: "No Country Code", company: null, phone: "9876543210" },
      ],
      profiles,
    });
    const out = await resolveRecipients(client, cfg({ type: "customer" }), {
      accountId: ACCOUNT,
      contactId: "ct-nocc",
    });
    // Still attempted — a hard block would be guessing, since a few countries
    // do produce short international numbers.
    expect(out[0].reachable).toBe(true);
    expect(out[0].warning).toMatch(/no country code/i);
    expect(out[0].warning).toMatch(/\+919876543210/);
  });

  it("does not warn about a number that already carries a country code", async () => {
    const { client } = fakeDb({ contacts, profiles });
    const out = await resolveRecipients(client, cfg({ type: "customer" }), {
      accountId: ACCOUNT,
      contactId: "ct-1",
    });
    expect(out[0].reachable).toBe(true);
    expect(out[0].warning).toBeUndefined();
  });

  it("explains when the record has no customer at all", async () => {
    const { client } = fakeDb({ contacts, profiles });
    const out = await resolveRecipients(client, cfg({ type: "customer" }), {
      accountId: ACCOUNT,
      contactId: null,
    });
    expect(out[0].reachable).toBe(false);
    expect(out[0].reason).toMatch(/no customer linked/i);
  });

  it("will not resolve a customer belonging to another account", async () => {
    const { client } = fakeDb({
      contacts: [{ id: "ct-x", account_id: "other-account", name: "Foreign", company: null, phone: "+911" }],
      profiles,
    });
    const out = await resolveRecipients(client, cfg({ type: "customer" }), {
      accountId: ACCOUNT,
      contactId: "ct-x",
    });
    expect(out[0].reachable).toBe(false);
    expect(out[0].phone).toBeNull();
  });
});

describe("resolveRecipients — employee and manager", () => {
  it("resolves the employee who created the record", async () => {
    const { client } = fakeDb({ contacts, profiles });
    const out = await resolveRecipients(client, cfg({ type: "creator" }), {
      accountId: ACCOUNT,
      creatorUserId: "u-rep",
    });
    expect(out[0]).toMatchObject({
      type: "creator",
      key: "creator:u-rep",
      label: "Ramesh",
      phone: "919000000011",
      reachable: true,
    });
    // Internal recipients must never carry conversation context — their message
    // does not belong in the customer inbox.
    expect(out[0].contactId).toBeUndefined();
  });

  it("names the employee when they have no phone saved", async () => {
    // Real state: only 3 of 13 employees have a phone. This must be visible.
    const { client } = fakeDb({ contacts, profiles });
    const out = await resolveRecipients(client, cfg({ type: "creator" }), {
      accountId: ACCOUNT,
      creatorUserId: "u-nophone",
    });
    expect(out[0].reachable).toBe(false);
    expect(out[0].reason).toMatch(/no phone number saved for Suresh/i);
  });

  it("resolves the manager via profiles.id, not profiles.user_id", async () => {
    // manager_id is an FK to profiles(id) — resolving it against user_id would
    // silently find nobody.
    const { client } = fakeDb({ contacts, profiles });
    const out = await resolveRecipients(client, cfg({ type: "creator_manager" }), {
      accountId: ACCOUNT,
      creatorUserId: "u-rep",
    });
    expect(out[0]).toMatchObject({
      type: "creator_manager",
      key: "creator_manager:u-mgr",
      label: "Priya",
      phone: "919000000022",
      reachable: true,
    });
  });

  it("explains when the employee has no manager set", async () => {
    const { client } = fakeDb({ contacts, profiles });
    const out = await resolveRecipients(client, cfg({ type: "creator_manager" }), {
      accountId: ACCOUNT,
      creatorUserId: "u-mgr",
    });
    expect(out[0].reachable).toBe(false);
    expect(out[0].reason).toMatch(/Priya has no manager set/i);
  });

  it("explains when the creating employee cannot be found", async () => {
    const { client } = fakeDb({ contacts, profiles });
    const out = await resolveRecipients(client, cfg({ type: "creator" }), {
      accountId: ACCOUNT,
      creatorUserId: "u-ghost",
    });
    expect(out[0].reachable).toBe(false);
    expect(out[0].reason).toMatch(/could not be found/i);
  });
});

describe("resolveRecipients — fixed number", () => {
  it("accepts a valid E.164 number with the admin's label", async () => {
    const { client } = fakeDb({ contacts, profiles });
    const out = await resolveRecipients(
      client,
      cfg({ type: "fixed_number", phone: "+919000000099", label: "Dispatch desk" }),
      { accountId: ACCOUNT },
    );
    expect(out[0]).toMatchObject({
      type: "fixed_number",
      label: "Dispatch desk",
      phone: "919000000099",
      reachable: true,
    });
  });

  it("rejects an empty or malformed number", async () => {
    const { client } = fakeDb({ contacts, profiles });
    const empty = await resolveRecipients(client, cfg({ type: "fixed_number" }), { accountId: ACCOUNT });
    expect(empty[0].reachable).toBe(false);
    expect(empty[0].reason).toMatch(/no number was entered/i);

    const bad = await resolveRecipients(
      client,
      cfg({ type: "fixed_number", phone: "98765" }),
      { accountId: ACCOUNT },
    );
    expect(bad[0].reachable).toBe(false);
  });
});

describe("resolveRecipients — multiple recipients", () => {
  it("resolves customer and employee together, as a dispatch would", async () => {
    const { client } = fakeDb({ contacts, profiles });
    const out = await resolveRecipients(
      client,
      cfg({ type: "customer" }, { type: "creator" }),
      { accountId: ACCOUNT, contactId: "ct-1", creatorUserId: "u-rep" },
    );
    expect(out).toHaveLength(2);
    expect(out.every((r) => r.reachable)).toBe(true);
    expect(out.map((r) => r.type)).toEqual(["customer", "creator"]);
  });

  it("one unreachable recipient does not prevent the others", async () => {
    // A rep without a phone must not stop the customer's order confirmation.
    const { client } = fakeDb({ contacts, profiles });
    const out = await resolveRecipients(
      client,
      cfg({ type: "customer" }, { type: "creator" }),
      { accountId: ACCOUNT, contactId: "ct-1", creatorUserId: "u-nophone" },
    );
    expect(out).toHaveLength(2);
    expect(out[0].reachable).toBe(true);
    expect(out[1].reachable).toBe(false);
  });

  it("collapses recipients that resolve to the same number, so nobody is billed twice", async () => {
    const sharedPhone = [
      { id: "ct-9", account_id: ACCOUNT, name: "Self", company: null, phone: "+919000000011" },
    ];
    const { client } = fakeDb({ contacts: sharedPhone, profiles });
    const out = await resolveRecipients(
      client,
      cfg({ type: "customer" }, { type: "creator" }),
      { accountId: ACCOUNT, contactId: "ct-9", creatorUserId: "u-rep" },
    );
    expect(out).toHaveLength(1);
    // The customer entry wins, keeping the inbox thread context.
    expect(out[0].type).toBe("customer");
  });

  it("keeps every unreachable entry, even duplicates, so each is explained", async () => {
    const { client } = fakeDb({ contacts, profiles });
    const out = await resolveRecipients(
      client,
      cfg({ type: "creator" }, { type: "creator_manager" }),
      { accountId: ACCOUNT, creatorUserId: "u-ghost" },
    );
    expect(out).toHaveLength(2);
    expect(out.every((r) => !r.reachable)).toBe(true);
  });

  it("reads each related record only once, however many recipients need it", async () => {
    const { client, queryCount } = fakeDb({ contacts, profiles });
    await resolveRecipients(
      client,
      cfg({ type: "customer" }, { type: "creator" }, { type: "creator_manager" }),
      { accountId: ACCOUNT, contactId: "ct-1", creatorUserId: "u-rep" },
    );
    expect(queryCount.contacts).toBe(1);
    // One read for the creator (shared by both creator and manager), one for
    // the manager itself.
    expect(queryCount.profiles).toBe(2);
  });

  it("handles an empty recipient list without throwing", async () => {
    const { client } = fakeDb({ contacts, profiles });
    await expect(resolveRecipients(client, [], { accountId: ACCOUNT })).resolves.toEqual([]);
  });
});
