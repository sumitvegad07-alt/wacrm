import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => ({
  runReport: vi.fn(
    async (
      ..._args: [unknown, string, string, string[], string[], Record<string, unknown>, string | undefined, number | undefined]
    ): Promise<Record<string, unknown>[]> => [{ visit_count: 47 }],
  ),
}));
vi.mock("@/lib/dashboard/report-rpc", () => ({
  runReport: rpc.runReport,
  num: (v: unknown) => Number(v) || 0,
  str: (v: unknown) => String(v ?? ""),
}));

import { MCP_TOOLS, callTool, dataSetOf } from "./tools";
import type { McpContext } from "./session";

const ctx = {
  connectionId: "c1",
  accountId: "a1",
  profileId: "p1",
  clientName: "Claude",
  accountName: "Shah Traders",
  supabase: {} as never,
  timezone: "Asia/Kolkata",
  tenant: { plan: "CRM_SFA", moduleSettings: {}, allowWorkforceData: false },
} as McpContext;

const crmOnly = {
  ...ctx,
  tenant: { plan: "CRM", moduleSettings: {}, allowWorkforceData: false },
} as McpContext;

beforeEach(() => vi.clearAllMocks());

describe("MCP_TOOLS", () => {
  it("offers exactly three tools", () => {
    expect(MCP_TOOLS.map((t) => t.name).sort()).toEqual([
      "describe_data",
      "fetch_data",
      "list_data",
    ]);
  });

  it("tells the AI the order to call them in", () => {
    const fetchTool = MCP_TOOLS.find((t) => t.name === "fetch_data")!;
    expect(fetchTool.description).toMatch(/list_data first/i);
    expect(fetchTool.description).toMatch(/describe_data/i);
  });

  it("tells the AI never to send raw dates", () => {
    const fetchTool = MCP_TOOLS.find((t) => t.name === "fetch_data")!;
    expect(fetchTool.description).toMatch(/never send raw dates/i);
  });

  it("explains what truncated means, so a partial total is not reported as complete", () => {
    const fetchTool = MCP_TOOLS.find((t) => t.name === "fetch_data")!;
    expect(fetchTool.description).toMatch(/truncated/i);
  });

  it("constrains period to the named presets in the schema itself", () => {
    const fetchTool = MCP_TOOLS.find((t) => t.name === "fetch_data")!;
    const props = fetchTool.inputSchema.properties as Record<string, { enum?: string[] }>;
    expect(props.period.enum).toContain("last_180_days");
    expect(props.period.enum).not.toContain("custom");
  });

  it("gives every tool a usable JSON schema", () => {
    for (const t of MCP_TOOLS) {
      expect(t.inputSchema.type).toBe("object");
      expect(t.description.length).toBeGreaterThan(60);
    }
  });
});

describe("list_data", () => {
  it("returns the tenant timezone and their local today, so the AI need not guess", async () => {
    const r = (await callTool("list_data", {}, ctx)) as {
      timezone: string;
      today: string;
      account_name: string;
      data_sets: { name: string }[];
    };
    expect(r.timezone).toBe("Asia/Kolkata");
    expect(r.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.account_name).toBe("Shah Traders");
    expect(r.data_sets.length).toBeGreaterThan(0);
  });

  it("gives each data set a one-line summary, not the full notes", async () => {
    const r = (await callTool("list_data", {}, ctx)) as {
      data_sets: { name: string; summary: string }[];
    };
    for (const d of r.data_sets) {
      expect(d.summary.length).toBeGreaterThan(10);
      expect(d.summary.length).toBeLessThanOrEqual(201);
    }
  });

  it("omits data sets the tenant's plan does not include", async () => {
    const r = (await callTool("list_data", {}, crmOnly)) as {
      data_sets: { name: string }[];
    };
    const names = r.data_sets.map((d) => d.name);
    expect(names).not.toContain("visits");
    expect(names).toContain("orders");
  });

  it("never lists a sensitive data set while the switch is off", async () => {
    const r = (await callTool("list_data", {}, ctx)) as { data_sets: { name: string }[] };
    expect(r.data_sets.map((d) => d.name)).not.toContain("location_trail");
  });
});

describe("describe_data", () => {
  it("includes business notes and worked examples", async () => {
    const r = (await callTool("describe_data", { dataset: "visits" }, ctx)) as {
      notes: string;
      examples: string[];
      periods: string[];
    };
    expect(r.notes).toMatch(/productive/i);
    expect(r.examples.length).toBeGreaterThanOrEqual(2);
    expect(r.periods).toContain("last_180_days");
  });

  it("refuses to describe a data set the tenant may not read", async () => {
    // Describing reveals the shape, and the menu is not the enforcement point.
    await expect(callTool("describe_data", { dataset: "visits" }, crmOnly)).rejects.toThrow(
      /plan/i,
    );
  });

  it("refuses an unknown data set and points at list_data", async () => {
    await expect(callTool("describe_data", { dataset: "salaries" }, ctx)).rejects.toThrow(
      /list_data/,
    );
  });

  it("asks for a dataset name when none was given", async () => {
    await expect(callTool("describe_data", {}, ctx)).rejects.toThrow(/needs a dataset/i);
    await expect(callTool("describe_data", { dataset: 42 }, ctx)).rejects.toThrow(
      /needs a dataset/i,
    );
  });
});

describe("fetch_data", () => {
  it("reaches the report engine for a report data set", async () => {
    await callTool(
      "fetch_data",
      { dataset: "visits", period: "today", measures: ["visit_count"] },
      ctx,
    );
    expect(rpc.runReport).toHaveBeenCalled();
  });

  it("enforces gating, not just the menu", async () => {
    await expect(
      callTool("fetch_data", { dataset: "visits", period: "today" }, crmOnly),
    ).rejects.toThrow(/plan/i);
  });
});

describe("callTool", () => {
  it("rejects an unknown tool name", async () => {
    await expect(callTool("drop_tables", {}, ctx)).rejects.toThrow(/unknown tool/i);
  });

  it("names the tools it does offer, so the AI can recover", async () => {
    await expect(callTool("read_everything", {}, ctx)).rejects.toThrow(/list_data/);
  });
});

describe("dataSetOf", () => {
  it("extracts the data set for the audit log", () => {
    expect(dataSetOf("fetch_data", { dataset: "visits" })).toBe("visits");
    expect(dataSetOf("describe_data", { dataset: "orders" })).toBe("orders");
  });

  it("has nothing to record for list_data", () => {
    expect(dataSetOf("list_data", {})).toBeUndefined();
  });

  it("survives a malformed argument object", () => {
    expect(dataSetOf("fetch_data", null)).toBeUndefined();
    expect(dataSetOf("fetch_data", { dataset: 42 })).toBeUndefined();
  });
});
