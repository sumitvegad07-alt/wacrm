import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { drainEvents, renderParams, type EventContext } from "./event-worker";
import type { ConditionRule } from "./condition-eval";
import { SimulatorProvider } from "./providers";
import { PermanentSendError, TransientSendError } from "./providers/types";

// ------------------------------------------------------------
// An in-memory stand-in for the tables the worker touches. Enough of the
// PostgREST surface to exercise claim/insert/update/select, including the
// unique constraint on deliveries — which is the whole idempotency story, so
// faking it away would defeat the point of the tests.
// ------------------------------------------------------------
type Row = Record<string, unknown>;
type Filter = ["eq" | "lt", string, unknown];
type QueryResult = { data: Row[] | Row | null; error: { message: string; code?: string } | null };

interface FakeBuilder {
  select(): FakeBuilder;
  insert(p: Row): FakeBuilder;
  update(p: Row): FakeBuilder;
  eq(col: string, val: unknown): FakeBuilder;
  lt(col: string, val: unknown): FakeBuilder;
  order(col: string, o?: { ascending?: boolean }): FakeBuilder;
  limit(n: number): FakeBuilder;
  maybeSingle(): Promise<QueryResult>;
  single(): Promise<QueryResult>;
  then(resolve: (value: QueryResult) => unknown): Promise<unknown>;
}

function makeDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));

  function matches(row: Row, filters: Filter[]): boolean {
    return filters.every(([op, col, val]) => {
      if (op === "eq") return row[col] === val;
      if (op === "lt") return row[col] != null && String(row[col]) < String(val);
      return true;
    });
  }

  const client = {
    from(table: string): FakeBuilder {
      tables[table] ??= [];
      const filters: Filter[] = [];
      let mode: "select" | "insert" | "update" = "select";
      let payload: Row | null = null;
      let orderCol: string | null = null;
      let orderAsc = true;
      let limitN: number | null = null;

      const builder: FakeBuilder = {
        select() {
          return builder;
        },
        insert(p: Row) {
          mode = "insert";
          payload = p;
          return builder;
        },
        update(p: Row) {
          mode = "update";
          payload = p;
          return builder;
        },
        eq(col: string, val: unknown) {
          filters.push(["eq", col, val]);
          return builder;
        },
        lt(col: string, val: unknown) {
          filters.push(["lt", col, val]);
          return builder;
        },
        order(col: string, o?: { ascending?: boolean }) {
          orderCol = col;
          orderAsc = o?.ascending !== false;
          return builder;
        },
        limit(n: number) {
          limitN = n;
          return builder;
        },
        async maybeSingle() {
          const r = await run();
          return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
        },
        async single() {
          return builder.maybeSingle();
        },
        then(resolve: (value: QueryResult) => unknown) {
          return run().then(resolve);
        },
      };

      async function run(): Promise<QueryResult> {
        if (mode === "insert") {
          // Enforce the delivery unique constraint for real.
          if (table === "automation_event_deliveries") {
            const clash = tables[table].find(
              (r) =>
                r.event_id === payload!.event_id &&
                r.automation_id === payload!.automation_id &&
                r.recipient_key === payload!.recipient_key,
            );
            if (clash) {
              return { data: null, error: { code: "23505", message: "duplicate key" } };
            }
          }
          const row = { id: `${table}-${tables[table].length + 1}`, ...payload };
          tables[table].push(row);
          return { data: [row], error: null };
        }

        if (mode === "update") {
          const hits = tables[table].filter((r) => matches(r, filters));
          hits.forEach((r) => Object.assign(r, payload));
          return { data: hits, error: null };
        }

        let rows = tables[table].filter((r) => matches(r, filters));
        if (orderCol) {
          rows = [...rows].sort((a, b) =>
            orderAsc
              ? String(a[orderCol!]).localeCompare(String(b[orderCol!]))
              : String(b[orderCol!]).localeCompare(String(a[orderCol!])),
          );
        }
        if (limitN != null) rows = rows.slice(0, limitN);
        return { data: rows, error: null };
      }

      return builder;
    },
  };

  return { db: client as unknown as SupabaseClient, tables };
}

const ACCOUNT = "acc-1";
const NOW = new Date("2026-08-11T10:00:00Z");

function baseSeed(over: Partial<Record<string, Row[]>> = {}) {
  return {
    accounts: [{ id: ACCOUNT, settings: {} }],
    contacts: [
      {
        id: "ct-1",
        account_id: ACCOUNT,
        user_id: "u-rep",
        company: "Campus Grocery",
        name: "Campus Grocery Mart",
        phone: "+919876543204",
        state: "Gujarat",
        city: "Rajkot",
      },
    ],
    orders: [],
    profiles: [
      {
        id: "pr-rep",
        user_id: "u-rep",
        account_id: ACCOUNT,
        full_name: "Ramesh",
        phone: "+919000000011",
        manager_id: null,
      },
    ],
    conversations: [],
    automations: [
      {
        id: "auto-1",
        account_id: ACCOUNT,
        user_id: "u-rep",
        trigger_type: "order_created",
        is_active: true,
        trigger_config: { module: "order" },
      },
    ],
    automation_steps: [
      {
        id: "st-1",
        automation_id: "auto-1",
        position: 0,
        step_type: "send_template",
        step_config: {
          template_name: "order_confirmation",
          language: "en",
          variables: { "1": "{{customer.company}}", "2": "{{order.order_number}}" },
          recipients: [{ type: "customer" }],
        },
      },
    ],
    automation_events: [
      {
        id: "ev-1",
        account_id: ACCOUNT,
        module: "order",
        event_type: "order_created",
        record_id: "ord-1",
        record_snapshot: {
          id: "ord-1",
          account_id: ACCOUNT,
          user_id: "u-rep",
          contact_id: "ct-1",
          order_number: "ORD-0020",
          status: "Pending",
          total_amount: "2142.00",
        },
        previous_snapshot: null,
        changed_fields: null,
        occurred_at: "2026-08-11T09:55:00Z",
        status: "pending",
        attempts: 0,
        processed_at: null,
      },
    ],
    automation_event_deliveries: [],
    ...over,
  } as Record<string, Row[]>;
}

/** The action config on the seeded automation, typed for direct mutation. */
function stepConfig(seed: Record<string, Row[]>): Record<string, unknown> {
  return seed.automation_steps[0].step_config as Record<string, unknown>;
}

let provider: SimulatorProvider;
beforeEach(() => {
  provider = new SimulatorProvider();
});

const run = (db: SupabaseClient, p: SimulatorProvider = provider) =>
  drainEvents({ db, provider: p, now: () => NOW });

describe("drainEvents — happy path", () => {
  it("sends one message and marks the event done", async () => {
    const { db, tables } = makeDb(baseSeed());
    const result = await run(db);

    expect(result.processed).toBe(1);
    expect(result.sent).toBe(1);
    expect(provider.count).toBe(1);
    expect(tables.automation_events[0].status).toBe("done");
  });

  it("renders template variables from the event and its customer", async () => {
    const { db } = makeDb(baseSeed());
    await run(db);
    expect(provider.log[0].params).toEqual(["Campus Grocery", "ORD-0020"]);
    expect(provider.log[0].templateName).toBe("order_confirmation");
    expect(provider.log[0].toPhone).toBe("919876543204");
  });

  it("creates a conversation so a customer who never messaged still gets it", async () => {
    const { db, tables } = makeDb(baseSeed());
    await run(db);
    expect(tables.conversations).toHaveLength(1);
    expect(provider.log[0].conversation).toBeDefined();
  });

  it("records the delivery as sent", async () => {
    const { db, tables } = makeDb(baseSeed());
    await run(db);
    expect(tables.automation_event_deliveries).toHaveLength(1);
    expect(tables.automation_event_deliveries[0]).toMatchObject({
      status: "sent",
      recipient_type: "customer",
      recipient_phone: "919876543204",
    });
  });
});

describe("drainEvents — conditions", () => {
  const withCondition = (rules: ConditionRule[], expression?: string) => {
    const seed = baseSeed();
    seed.automations[0].trigger_config = {
      module: "order",
      conditions: { rules, expression },
    };
    return seed;
  };

  it("sends when the Gujarat rule matches", async () => {
    const { db } = makeDb(
      withCondition([{ id: 1, field: "customer.state", operator: "equals", value: "Gujarat" }]),
    );
    await run(db);
    expect(provider.count).toBe(1);
  });

  it("does not send when the rule does not match", async () => {
    const { db, tables } = makeDb(
      withCondition([
        { id: 1, field: "customer.state", operator: "equals", value: "Maharashtra" },
      ]),
    );
    await run(db);
    expect(provider.count).toBe(0);
    // The event is still completed, not left hanging.
    expect(tables.automation_events[0].status).toBe("done");
    expect(tables.automation_event_deliveries).toHaveLength(0);
  });

  it("honours grouped expressions", async () => {
    const { db } = makeDb(
      withCondition(
        [
          { id: 1, field: "customer.state", operator: "equals", value: "Gujarat" },
          { id: 2, field: "customer.city", operator: "equals", value: "Surat" },
          { id: 3, field: "order.total_amount", operator: "greater_than", value: 2000 },
        ],
        "1 AND (2 OR 3)",
      ),
    );
    await run(db);
    // Gujarat yes, Surat no, but 2142 > 2000 → sends.
    expect(provider.count).toBe(1);
  });

  it("sends with no conditions at all", async () => {
    const { db } = makeDb(withCondition([]));
    await run(db);
    expect(provider.count).toBe(1);
  });
});

describe("drainEvents — safety guards", () => {
  it("sends nothing when the kill switch is on", async () => {
    const seed = baseSeed();
    seed.accounts[0].settings = { automation_settings: { enabled: false } };
    const { db, tables } = makeDb(seed);

    const result = await run(db);

    expect(provider.count).toBe(0);
    expect(result.skipped).toBe(1);
    expect(tables.automation_events[0].status).toBe("skipped");
    expect(tables.automation_events[0].skip_reason).toBe("kill_switch");
  });

  it("treats a missing kill-switch setting as enabled", async () => {
    const seed = baseSeed();
    seed.accounts[0].settings = { order_settings: {} };
    const { db } = makeDb(seed);
    await run(db);
    expect(provider.count).toBe(1);
  });

  it("skips an event older than the staleness cutoff", async () => {
    // A rep's offline order syncing the next morning must not tell a customer
    // their order was just received.
    const seed = baseSeed();
    seed.automation_events[0].occurred_at = "2026-08-10T20:00:00Z"; // 14h before NOW
    const { db, tables } = makeDb(seed);

    const result = await run(db);

    expect(provider.count).toBe(0);
    expect(result.skipped).toBe(1);
    expect(tables.automation_events[0].skip_reason).toBe("stale");
  });

  it("still sends just inside the cutoff", async () => {
    const seed = baseSeed();
    seed.automation_events[0].occurred_at = "2026-08-10T22:30:00Z"; // 11.5h
    const { db } = makeDb(seed);
    await run(db);
    expect(provider.count).toBe(1);
  });

  it("respects a custom staleness window", async () => {
    const seed = baseSeed();
    seed.accounts[0].settings = { automation_settings: { stale_event_hours: 24 } };
    seed.automation_events[0].occurred_at = "2026-08-10T20:00:00Z"; // 14h
    const { db } = makeDb(seed);
    await run(db);
    expect(provider.count).toBe(1);
  });

  it("completes an event with no matching automation without sending", async () => {
    const seed = baseSeed({ automations: [] });
    const { db, tables } = makeDb(seed);
    await run(db);
    expect(provider.count).toBe(0);
    expect(tables.automation_events[0].status).toBe("done");
    expect(tables.automation_events[0].skip_reason).toBe("no_matching_automation");
  });

  it("ignores inactive automations", async () => {
    const seed = baseSeed();
    seed.automations[0].is_active = false;
    const { db } = makeDb(seed);
    await run(db);
    expect(provider.count).toBe(0);
  });

  it("ignores automations belonging to another account", async () => {
    const seed = baseSeed();
    seed.automations[0].account_id = "other-account";
    const { db } = makeDb(seed);
    await run(db);
    expect(provider.count).toBe(0);
  });
});

describe("drainEvents — idempotency", () => {
  it("does not send twice when the same event is drained again", async () => {
    // The single most important guarantee: a customer must never get the same
    // order confirmation twice, and Meta must never be billed twice.
    const { db, tables } = makeDb(baseSeed());

    await run(db);
    expect(provider.count).toBe(1);

    // Simulate a crash after sending: the event goes back to pending, but the
    // delivery row survives.
    tables.automation_events[0].status = "pending";
    await run(db);

    expect(provider.count).toBe(1);
    expect(tables.automation_event_deliveries).toHaveLength(1);
  });

  it("does not process an event another worker already claimed", async () => {
    const seed = baseSeed();
    seed.automation_events[0].status = "processing";
    const { db } = makeDb(seed);
    const result = await run(db);
    expect(result.processed).toBe(0);
    expect(provider.count).toBe(0);
  });
});

describe("drainEvents — failures", () => {
  it("records an unreachable recipient without failing the event", async () => {
    const seed = baseSeed();
    seed.contacts[0].phone = null;
    const { db, tables } = makeDb(seed);

    const result = await run(db);

    expect(provider.count).toBe(0);
    expect(result.outcomes[0].skippedRecipients).toBe(1);
    expect(tables.automation_events[0].status).toBe("done");
    expect(tables.automation_event_deliveries[0]).toMatchObject({ status: "skipped" });
    expect(tables.automation_event_deliveries[0].detail).toMatch(/no phone number/i);
  });

  it("a permanent send failure does not retry the whole event", async () => {
    const failing = new SimulatorProvider(() => new PermanentSendError("Template not found"));
    const { db, tables } = makeDb(baseSeed());

    const result = await run(db, failing);

    expect(result.outcomes[0].failedRecipients).toBe(1);
    expect(tables.automation_events[0].status).toBe("done");
    expect(tables.automation_event_deliveries[0]).toMatchObject({ status: "failed" });
  });

  it("a transient failure requeues the event for another attempt", async () => {
    const failing = new SimulatorProvider(() => new TransientSendError("rate limit"));
    const { db, tables } = makeDb(baseSeed());

    const result = await run(db, failing);

    expect(result.requeued).toBe(1);
    expect(tables.automation_events[0].status).toBe("pending");
    expect(tables.automation_events[0].attempts).toBe(1);
  });

  it("gives up visibly after the attempt limit instead of becoming a zombie", async () => {
    // A row silently skipped forever is the defect pattern this codebase
    // already suffered from once. Failure must be terminal and visible.
    const failing = new SimulatorProvider(() => new TransientSendError("rate limit"));
    const seed = baseSeed();
    seed.automation_events[0].attempts = 2;
    const { db, tables } = makeDb(seed);

    const result = await run(db, failing);

    expect(result.failed).toBe(1);
    expect(tables.automation_events[0].status).toBe("failed");
    expect(tables.automation_events[0].last_error).toMatch(/rate limit/i);
  });
});

describe("drainEvents — ordering and recovery", () => {
  it("processes oldest events first so a confirmation precedes its dispatch", async () => {
    const seed = baseSeed();
    seed.automation_events.push({
      ...seed.automation_events[0],
      id: "ev-2",
      record_id: "ord-2",
      record_snapshot: {
        ...(seed.automation_events[0].record_snapshot as Row),
        order_number: "ORD-0021",
      },
      occurred_at: "2026-08-11T09:58:00Z",
    });
    const { db } = makeDb(seed);

    await run(db);

    expect(provider.log.map((s) => s.params[1])).toEqual(["ORD-0020", "ORD-0021"]);
  });

  it("recovers events abandoned by a crashed worker", async () => {
    const seed = baseSeed();
    seed.automation_events[0].status = "processing";
    seed.automation_events[0].processed_at = "2026-08-11T09:00:00Z"; // an hour stale
    const { db } = makeDb(seed);

    const result = await run(db);

    expect(result.processed).toBe(1);
    expect(provider.count).toBe(1);
  });

  it("leaves a recently-claimed event alone", async () => {
    const seed = baseSeed();
    seed.automation_events[0].status = "processing";
    seed.automation_events[0].processed_at = "2026-08-11T09:59:30Z"; // 30s ago
    const { db } = makeDb(seed);

    const result = await run(db);
    expect(result.processed).toBe(0);
  });

  it("returns cleanly when there is nothing to do", async () => {
    const { db } = makeDb(baseSeed({ automation_events: [] }));
    const result = await run(db);
    expect(result).toMatchObject({ processed: 0, sent: 0 });
  });
});

describe("drainEvents — internal recipients", () => {
  it("sends to the employee without creating a conversation", async () => {
    const seed = baseSeed();
    stepConfig(seed).recipients = [{ type: "creator" }];
    const { db, tables } = makeDb(seed);

    await run(db);

    expect(provider.count).toBe(1);
    expect(provider.log[0].toPhone).toBe("919000000011");
    // Internal alerts must not appear in the customer inbox.
    expect(provider.log[0].conversation).toBeUndefined();
    expect(tables.conversations).toHaveLength(0);
  });

  it("sends to customer and employee together, as a dispatch would", async () => {
    const seed = baseSeed();
    stepConfig(seed).recipients = [{ type: "customer" }, { type: "creator" }];
    const { db } = makeDb(seed);

    await run(db);

    expect(provider.count).toBe(2);
    expect(provider.log.map((s) => s.toPhone).sort()).toEqual([
      "919000000011",
      "919876543204",
    ]);
  });
});

describe("renderParams", () => {
  const ctx: EventContext = {
    customer: { company: "Campus Grocery", state: "Gujarat", pincode: null },
    order: { order_number: "ORD-0020", total_amount: "2142.00" },
  };

  it("resolves field references and passes literals through", () => {
    expect(
      renderParams({ "1": "{{customer.company}}", "2": "Thanks!" }, ctx),
    ).toEqual(["Campus Grocery", "Thanks!"]);
  });

  it("orders parameters numerically, not alphabetically", () => {
    // Sorting "1","2",…,"10" as text gives 1,10,2 — which silently scrambles
    // every template with ten or more variables.
    const vars: Record<string, string> = {};
    for (let i = 1; i <= 11; i++) vars[String(i)] = `v${i}`;
    expect(renderParams(vars, ctx)).toEqual([
      "v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8", "v9", "v10", "v11",
    ]);
  });

  it("renders an unresolvable or null field as an empty string, never a gap", () => {
    // Meta rejects a template call with a missing positional parameter, so a
    // blank is recoverable where a dropped slot is not.
    expect(
      renderParams({ "1": "{{customer.pincode}}", "2": "{{customer.nope}}", "3": "{{bad}}" }, ctx),
    ).toEqual(["", "", ""]);
  });

  it("tolerates whitespace inside the braces", () => {
    expect(renderParams({ "1": "{{  customer.state  }}" }, ctx)).toEqual(["Gujarat"]);
  });

  it("returns nothing when no variables are configured", () => {
    expect(renderParams(undefined, ctx)).toEqual([]);
    expect(renderParams({}, ctx)).toEqual([]);
  });
});
