import { describe, it, expect } from "vitest";
import {
  DEFAULT_DAILY_CAP,
  LONG_BREAK_MAX_SEC,
  LONG_BREAK_MIN_SEC,
  MAX_POLL_WAIT_SEC,
  OPT_OUT_LINE,
  OUTREACH_TIMEZONE,
  daysBetween,
  daysSending,
  decide,
  isInSendWindow,
  isLongBreakDue,
  parseHhMm,
  pickVariant,
  renderMessage,
  requiredGapSeconds,
  warmUpCap,
  zonedClock,
  type DecideInput,
  type SendWindow,
} from "./outreach-policy";

const WINDOW: SendWindow = {
  windowStart: "10:00",
  windowEnd: "18:30",
  weekdaysOnly: true,
};

/** 2026-10-19 is a Monday. Helper builds an IST instant. */
function ist(ymd: string, hhmm: string): Date {
  return new Date(`${ymd}T${hhmm}:00+05:30`);
}

describe("zonedClock", () => {
  it("reads the date and time in India, not UTC", () => {
    // 19:30 UTC on the 19th is 01:00 IST on the 20th.
    const clock = zonedClock(new Date("2026-10-19T19:30:00Z"), OUTREACH_TIMEZONE);
    expect(clock.ymd).toBe("2026-10-20");
    expect(clock.minutes).toBe(60);
  });

  it("reports midnight as 0 minutes, not 1440", () => {
    // Intl with hour12:false renders midnight as hour "24" in some runtimes.
    const clock = zonedClock(ist("2026-10-19", "00:00"), OUTREACH_TIMEZONE);
    expect(clock.minutes).toBe(0);
  });

  it("numbers Sunday 0 through Saturday 6", () => {
    expect(zonedClock(ist("2026-10-18", "12:00"), OUTREACH_TIMEZONE).weekday).toBe(0);
    expect(zonedClock(ist("2026-10-19", "12:00"), OUTREACH_TIMEZONE).weekday).toBe(1);
    expect(zonedClock(ist("2026-10-24", "12:00"), OUTREACH_TIMEZONE).weekday).toBe(6);
  });
});

describe("parseHhMm", () => {
  it("turns a clock string into minutes since midnight", () => {
    expect(parseHhMm("10:00")).toBe(600);
    expect(parseHhMm("18:30")).toBe(1110);
  });
});

describe("isInSendWindow", () => {
  const at = (ymd: string, hhmm: string) =>
    isInSendWindow(zonedClock(ist(ymd, hhmm), OUTREACH_TIMEZONE), WINDOW);

  it("treats the end of the window as exclusive", () => {
    expect(at("2026-10-19", "18:29")).toBe(true);
    expect(at("2026-10-19", "18:30")).toBe(false);
    expect(at("2026-10-19", "18:31")).toBe(false);
  });

  it("opens exactly on the hour and not a minute before", () => {
    expect(at("2026-10-19", "09:59")).toBe(false);
    expect(at("2026-10-19", "10:00")).toBe(true);
  });

  it("never sends at the weekend when weekdaysOnly", () => {
    expect(at("2026-10-18", "12:00")).toBe(false); // Sunday
    expect(at("2026-10-24", "12:00")).toBe(false); // Saturday
  });

  it("sends at the weekend when weekdaysOnly is off", () => {
    const clock = zonedClock(ist("2026-10-18", "12:00"), OUTREACH_TIMEZONE);
    expect(isInSendWindow(clock, { ...WINDOW, weekdaysOnly: false })).toBe(true);
  });
});

describe("requiredGapSeconds", () => {
  it("stays inside the range for every counter", () => {
    for (let n = 0; n < 1000; n++) {
      const gap = requiredGapSeconds(n, 45, 120);
      expect(gap).toBeGreaterThanOrEqual(45);
      expect(gap).toBeLessThanOrEqual(120);
    }
  });

  it("is the same every time for one counter", () => {
    // Repeated /next polls during a single wait must compute the same
    // deadline, or the wait never ends.
    expect(requiredGapSeconds(7, 45, 120)).toBe(requiredGapSeconds(7, 45, 120));
  });

  it("varies between consecutive messages", () => {
    // A fixed gap is the clearest bot signature there is.
    const seen = new Set<number>();
    for (let n = 0; n < 100; n++) seen.add(requiredGapSeconds(n, 45, 120));
    expect(seen.size).toBeGreaterThan(20);
  });

  it("collapses to the floor when the range is empty", () => {
    expect(requiredGapSeconds(3, 60, 60)).toBe(60);
  });
});

describe("isLongBreakDue", () => {
  it("fires on the 20th send and not the 21st", () => {
    expect(isLongBreakDue(19)).toBe(false);
    expect(isLongBreakDue(20)).toBe(true);
    expect(isLongBreakDue(21)).toBe(false);
    expect(isLongBreakDue(40)).toBe(true);
  });

  it("does not fire before anything has been sent", () => {
    expect(isLongBreakDue(0)).toBe(false);
  });
});

describe("daysBetween / daysSending", () => {
  it("counts calendar days without a timezone sneaking in", () => {
    expect(daysBetween("2026-10-19", "2026-10-21")).toBe(2);
    expect(daysBetween("2026-02-27", "2026-03-01")).toBe(2); // 2026 is not a leap year
  });

  it("calls a number that has never sent day one", () => {
    expect(daysSending(null, "2026-10-19")).toBe(1);
  });

  it("calls the first day of sending day one", () => {
    expect(daysSending("2026-10-19", "2026-10-19")).toBe(1);
  });

  it("counts the third day as three", () => {
    expect(daysSending("2026-10-19", "2026-10-21")).toBe(3);
  });
});

describe("warmUpCap", () => {
  it("opens at 20 and climbs 20 a day", () => {
    expect(warmUpCap(1, DEFAULT_DAILY_CAP)).toBe(20);
    expect(warmUpCap(2, DEFAULT_DAILY_CAP)).toBe(40);
    expect(warmUpCap(3, DEFAULT_DAILY_CAP)).toBe(60);
  });

  it("never exceeds the cap the founder set", () => {
    expect(warmUpCap(4, DEFAULT_DAILY_CAP)).toBe(80);
    expect(warmUpCap(99, DEFAULT_DAILY_CAP)).toBe(80);
    expect(warmUpCap(99, 30)).toBe(30);
  });
});

describe("pickVariant", () => {
  it("spreads evenly across a thousand recipients", () => {
    const counts = [0, 0, 0];
    for (let id = 1; id <= 999; id++) counts[pickVariant(id, 3)]++;
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it("stays in range for two variants", () => {
    expect(pickVariant(1, 2)).toBeLessThan(2);
    expect(pickVariant(5000, 2)).toBeLessThan(2);
    expect(pickVariant(5000, 2)).toBeGreaterThanOrEqual(0);
  });
});

describe("renderMessage", () => {
  it("substitutes the merge fields", () => {
    const out = renderMessage("Hello {name} in {city}", {
      name: "Shah Industries",
      city: "Hubballi",
      industry: "seeds",
    });
    expect(out).toContain("Hello Shah Industries in Hubballi");
  });

  it("falls back rather than leaving a hole when Google gave us nothing", () => {
    // Google returns blank city constantly, and "Hello ," reads as a bot.
    const out = renderMessage("Hello {name} in {city}", {
      name: "",
      city: "",
      industry: "",
    });
    expect(out).not.toContain("{");
    expect(out).not.toContain("Hello  in");
    expect(out).toContain("Hello there");
  });

  it("strips a merge field nobody defined", () => {
    const out = renderMessage("Hi {name}, about {nonsense} today", { name: "A" });
    expect(out).not.toContain("{nonsense}");
    expect(out).not.toContain("  ");
  });

  it("never lets a brace reach a prospect, however the token is malformed", () => {
    for (const template of [
      "Hi {first name}, hello",
      "Hi { name }, hello",
      "Hi {city-name}, hello",
      "Hi {{name}}, hello",
      "Hi {name, hello",
      "Hi name}, hello",
    ]) {
      const out = renderMessage(template, { name: "Shah Industries" });
      expect(out).not.toMatch(/[{}]/);
    }
  });

  it("drops the whole {{name}} group rather than sending {Shah Industries}", () => {
    // The inner token is substituted first, leaving `{Shah Industries}`, which
    // the brace pass then removes. The name is lost but the message stays
    // clean: failing safe, not failing visibly to the prospect.
    const out = renderMessage("Hi {{name}}, hello", { name: "Shah Industries" });
    expect(out).not.toContain("Shah Industries");
    expect(out).toContain("Hi, hello");
  });

  it("appends the opt-out line exactly once", () => {
    const withIt = renderMessage(`Hi {name}. ${OPT_OUT_LINE}`, { name: "A" });
    expect(withIt.split(OPT_OUT_LINE)).toHaveLength(2);
    const without = renderMessage("Hi {name}.", { name: "A" });
    expect(without).toContain(OPT_OUT_LINE);
  });
});

describe("decide", () => {
  const base: DecideInput = {
    now: ist("2026-10-19", "11:00"),
    timezone: OUTREACH_TIMEZONE,
    window: WINDOW,
    dailyCap: DEFAULT_DAILY_CAP,
    sentToday: 0,
    firstSentOn: "2026-10-01",
    lastSentAt: null,
    gapMinSec: 45,
    gapMaxSec: 120,
    queuedRemaining: 100,
    consecutiveFailures: 0,
  };

  it("sends the first message of the day immediately", () => {
    expect(decide(base)).toEqual({ kind: "send" });
  });

  it("pauses after three failures in a row", () => {
    // A campaign failing every send must stop even if it is inside the
    // window with plenty queued.
    const d = decide({ ...base, consecutiveFailures: 3 });
    expect(d.kind).toBe("paused");
  });

  it("pauses on three failures even with an empty queue", () => {
    expect(decide({ ...base, consecutiveFailures: 3, queuedRemaining: 0 }).kind)
      .toBe("paused");
  });

  it("pauses on three failures even outside the send window", () => {
    expect(
      decide({
        ...base,
        consecutiveFailures: 3,
        now: ist("2026-10-19", "21:00"),
      }).kind,
    ).toBe("paused");
  });

  it("still sends after two failures", () => {
    expect(decide({ ...base, consecutiveFailures: 2 }).kind).toBe("send");
  });

  it("is done when nothing is queued", () => {
    expect(decide({ ...base, queuedRemaining: 0 }).kind).toBe("done");
  });

  it("waits outside the window instead of sending", () => {
    const d = decide({ ...base, now: ist("2026-10-19", "21:00") });
    expect(d).toEqual({
      kind: "wait",
      waitSeconds: MAX_POLL_WAIT_SEC,
      reason: "Outside the send window",
    });
  });

  it("waits once the warmed-up cap for today is reached", () => {
    // Day 1 of a new number: the ceiling is 20, not the campaign's 80.
    const d = decide({ ...base, firstSentOn: "2026-10-19", sentToday: 20 });
    expect(d.kind).toBe("wait");
    if (d.kind === "wait") expect(d.reason).toContain("20");
  });

  it("still sends at 19 when the number is warm", () => {
    expect(decide({ ...base, sentToday: 19, firstSentOn: "2026-10-01" }).kind).toBe("send");
  });

  it("waits at the campaign's own cap once the number is fully warm", () => {
    expect(decide({ ...base, sentToday: 80 }).kind).toBe("wait");
  });

  it("still sends one short of the cap", () => {
    expect(decide({ ...base, sentToday: 79 }).kind).toBe("send");
  });

  it("lets a lower campaign cap bind before the ramp does", () => {
    const d = decide({ ...base, dailyCap: 30, sentToday: 30 });
    expect(d.kind).toBe("wait");
    if (d.kind === "wait") expect(d.reason).toContain("30");
  });

  it("stops rather than sends when a counter arrives as NaN", () => {
    expect(decide({ ...base, sentToday: Number.NaN }).kind).not.toBe("send");
  });

  it("spaces messages out when the last one was too recent", () => {
    const d = decide({
      ...base,
      sentToday: 1,
      lastSentAt: new Date(base.now.getTime() - 10_000),
    });
    expect(d.kind).toBe("wait");
    if (d.kind === "wait") {
      expect(d.waitSeconds).toBeGreaterThan(0);
      expect(d.waitSeconds).toBeLessThanOrEqual(120);
    }
  });

  it("sends once the gap has elapsed", () => {
    const d = decide({
      ...base,
      sentToday: 1,
      lastSentAt: new Date(base.now.getTime() - 121_000),
    });
    expect(d).toEqual({ kind: "send" });
  });

  it("sends exactly when the elapsed time equals the required gap", () => {
    // The 121s test above sits past the 120s maximum and never touches the
    // boundary. Compute the real gap for one count and land exactly on it.
    const sentToday = 7;
    const needed = requiredGapSeconds(sentToday, 45, 120);
    const justShort = decide({
      ...base,
      sentToday,
      lastSentAt: new Date(base.now.getTime() - (needed - 1) * 1000),
    });
    expect(justShort.kind).toBe("wait");
    const onTheDot = decide({
      ...base,
      sentToday,
      lastSentAt: new Date(base.now.getTime() - needed * 1000),
    });
    expect(onTheDot).toEqual({ kind: "send" });
  });

  it("takes a long break on the 20th, not a short gap", () => {
    const d = decide({
      ...base,
      sentToday: 20,
      firstSentOn: "2026-10-01",
      lastSentAt: new Date(base.now.getTime() - 130_000),
    });
    expect(d.kind).toBe("wait");
    if (d.kind === "wait") {
      expect(d.waitSeconds).toBeGreaterThan(LONG_BREAK_MIN_SEC - 130 - 1);
      expect(d.waitSeconds).toBeLessThanOrEqual(LONG_BREAK_MAX_SEC);
      expect(d.reason).toContain("break");
    }
  });
});
