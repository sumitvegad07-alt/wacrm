import { describe, expect, it } from "vitest";
import { classifyMetaError } from "./meta-provider";
import { SimulatorProvider } from "./simulator-provider";
import {
  PermanentSendError,
  TransientSendError,
  isPermanentSendError,
  type SendTemplateRequest,
} from "./types";

const req = (over: Partial<SendTemplateRequest> = {}): SendTemplateRequest => ({
  accountId: "acc-1",
  toPhone: "+919000000001",
  templateName: "order_confirmation",
  language: "en",
  params: ["ORD-0019", "75000"],
  ...over,
});

describe("SimulatorProvider", () => {
  it("records a send instead of performing one", async () => {
    const sim = new SimulatorProvider();
    const result = await sim.sendTemplate(req());

    expect(result.simulated).toBe(true);
    expect(result.messageId).toBe("sim-1");
    expect(sim.count).toBe(1);
    expect(sim.log[0]).toMatchObject({
      toPhone: "+919000000001",
      templateName: "order_confirmation",
      params: ["ORD-0019", "75000"],
    });
  });

  it("issues a distinct id per send", async () => {
    const sim = new SimulatorProvider();
    await sim.sendTemplate(req());
    await sim.sendTemplate(req({ toPhone: "+919000000002" }));
    expect(sim.log.map((s) => s.messageId)).toEqual(["sim-1", "sim-2"]);
  });

  it("can be queried per recipient", async () => {
    const sim = new SimulatorProvider();
    await sim.sendTemplate(req({ toPhone: "+911" }));
    await sim.sendTemplate(req({ toPhone: "+912" }));
    await sim.sendTemplate(req({ toPhone: "+911" }));
    expect(sim.sentTo("+911")).toHaveLength(2);
    expect(sim.sentTo("+913")).toHaveLength(0);
  });

  it("rejects a missing phone or template, like the real sender would", async () => {
    const sim = new SimulatorProvider();
    await expect(sim.sendTemplate(req({ toPhone: "" }))).rejects.toBeInstanceOf(PermanentSendError);
    await expect(sim.sendTemplate(req({ templateName: "" }))).rejects.toBeInstanceOf(PermanentSendError);
    expect(sim.count).toBe(0);
  });

  it("can be told to fail a specific recipient, so retry paths are testable", async () => {
    const sim = new SimulatorProvider((r) =>
      r.toPhone === "+919999999999" ? new TransientSendError("rate limit") : undefined,
    );
    await expect(sim.sendTemplate(req({ toPhone: "+919999999999" }))).rejects.toThrow("rate limit");
    await expect(sim.sendTemplate(req())).resolves.toMatchObject({ simulated: true });
    expect(sim.count).toBe(1);
  });

  it("distinguishes customer sends from internal ones", async () => {
    const sim = new SimulatorProvider();
    await sim.sendTemplate(req({ conversation: { conversationId: "cv-1", contactId: "ct-1" } }));
    await sim.sendTemplate(req({ toPhone: "+919000000009" }));

    // A customer send carries conversation context (it belongs in the inbox);
    // an internal send to an employee deliberately does not.
    expect(sim.log[0].conversation).toBeDefined();
    expect(sim.log[1].conversation).toBeUndefined();
  });

  it("resets cleanly between tests", async () => {
    const sim = new SimulatorProvider();
    await sim.sendTemplate(req());
    sim.reset();
    expect(sim.count).toBe(0);
    await sim.sendTemplate(req());
    expect(sim.log[0].messageId).toBe("sim-1");
  });
});

describe("classifyMetaError — retry decisions", () => {
  // Getting this wrong is expensive both ways: retrying a permanent rejection
  // hides the real problem, giving up on a blip loses a customer's message.
  it.each([
    "Template name does not exist in the translation",
    "(#132001) Template not found",
    "Invalid parameter",
    "Unsupported message type",
    "Invalid phone number",
    "Re-engagement message outside the allowed window",
    "Unauthorized: access token expired",
    "You do not have permission to send",
  ])("treats %s as permanent", (message) => {
    const classified = classifyMetaError(new Error(message));
    expect(isPermanentSendError(classified)).toBe(true);
  });

  it.each([
    "Rate limit hit, please retry",
    "Too many requests",
    "Request timed out",
    "socket hang up",
    "ECONNRESET",
    "Service unavailable",
    "503 Service Temporarily Unavailable",
    "429 Too Many Requests",
  ])("treats %s as transient", (message) => {
    const classified = classifyMetaError(new Error(message));
    expect(classified).toBeInstanceOf(TransientSendError);
  });

  it("treats an unrecognised failure as transient so it is not lost outright", () => {
    // The worker caps attempts, so an unknown permanent error costs two extra
    // tries rather than silently dropping a customer's message.
    expect(classifyMetaError(new Error("something nobody predicted"))).toBeInstanceOf(
      TransientSendError,
    );
  });

  it("handles a non-Error thrown value without crashing", () => {
    expect(() => classifyMetaError("just a string")).not.toThrow();
    expect(() => classifyMetaError(undefined)).not.toThrow();
    expect(() => classifyMetaError(null)).not.toThrow();
  });

  it("preserves the original message so logs stay diagnosable", () => {
    expect(classifyMetaError(new Error("Rate limit hit")).message).toBe("Rate limit hit");
  });
});
