import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SERVICE_ROLE_KEY_ENV_NAMES, serviceRoleKey } from "./service-role-key";

const SAVED: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const name of SERVICE_ROLE_KEY_ENV_NAMES) {
    SAVED[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  for (const name of SERVICE_ROLE_KEY_ENV_NAMES) {
    if (SAVED[name] === undefined) delete process.env[name];
    else process.env[name] = SAVED[name];
  }
});

describe("serviceRoleKey", () => {
  it("reads the canonical SUPABASE_SERVICE_ROLE_KEY", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "canonical-key";
    expect(serviceRoleKey()).toBe("canonical-key");
  });

  // The live bug: the Vercel production variable is named `service_role`, so
  // the canonical name is undefined and every service-role route 500s.
  it("falls back to the legacy service_role name", () => {
    process.env.service_role = "legacy-key";
    expect(serviceRoleKey()).toBe("legacy-key");
  });

  it("prefers the canonical name when both are set", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "canonical-key";
    process.env.service_role = "legacy-key";
    expect(serviceRoleKey()).toBe("canonical-key");
  });

  // A variable that exists but is blank must not shadow a usable fallback.
  it("ignores a blank canonical value and uses the fallback", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "   ";
    process.env.service_role = "legacy-key";
    expect(serviceRoleKey()).toBe("legacy-key");
  });

  it("returns undefined when no variable holds a key", () => {
    expect(serviceRoleKey()).toBeUndefined();
  });
});
