// The backward-compatibility contract of accounts.settings.geo_fencing.
//
// Attendance fencing added two keys to an object that is already live for
// visits. Getting either default wrong changes behaviour for tenants who asked
// for nothing: a wrong `visit_enabled` silently switches off a fence they rely
// on, a wrong `attendance_enabled` switches on one they never configured. Hence
// these tests.

import { describe, it, expect } from "vitest";
import {
  attendanceFencingOn,
  normalizeGeoFencing,
  visitFencingOn,
} from "./geofence-config";

describe("normalizeGeoFencing — defaults", () => {
  it("reads a missing object as everything off", () => {
    const c = normalizeGeoFencing(undefined);
    expect(c.enabled).toBe(false);
    expect(c.attendance_enabled).toBe(false);
  });

  it("treats an absent visit_enabled as ON, so tenants fencing visits today are unchanged", () => {
    // Exactly what a live tenant's JSONB looks like before this feature shipped.
    const c = normalizeGeoFencing({
      enabled: true,
      enforce_check_in: true,
      enforce_check_out: false,
      radius_m: 250,
    });
    expect(c.visit_enabled).toBe(true);
    expect(visitFencingOn(c)).toBe(true);
    expect(c.radius_m).toBe(250);
  });

  it("treats an absent attendance_enabled as OFF, so nobody gains a punch fence on deploy", () => {
    const c = normalizeGeoFencing({ enabled: true });
    expect(c.attendance_enabled).toBe(false);
    expect(attendanceFencingOn(c)).toBe(false);
  });

  it("falls back to a 50m radius when the stored value is not one of the presets", () => {
    expect(normalizeGeoFencing({ enabled: true, radius_m: 137 }).radius_m).toBe(50);
    expect(normalizeGeoFencing({ enabled: true, radius_m: "500" }).radius_m).toBe(500);
  });

  it("ignores a non-object value instead of throwing", () => {
    expect(normalizeGeoFencing("yes").enabled).toBe(false);
    expect(normalizeGeoFencing(null).enabled).toBe(false);
  });
});

describe("the parent switch governs both sub-switches", () => {
  it("reports both off when the parent is off, whatever the sub-switches say", () => {
    const c = normalizeGeoFencing({
      enabled: false,
      visit_enabled: true,
      attendance_enabled: true,
      enforce_check_in: true,
    });
    expect(visitFencingOn(c)).toBe(false);
    expect(attendanceFencingOn(c)).toBe(false);
  });

  it("lets the two run independently — they are not mutually exclusive", () => {
    const both = normalizeGeoFencing({
      enabled: true,
      visit_enabled: true,
      attendance_enabled: true,
      enforce_check_in: true,
    });
    expect(visitFencingOn(both)).toBe(true);
    expect(attendanceFencingOn(both)).toBe(true);

    const attendanceOnly = normalizeGeoFencing({
      enabled: true,
      visit_enabled: false,
      attendance_enabled: true,
    });
    expect(visitFencingOn(attendanceOnly)).toBe(false);
    expect(attendanceFencingOn(attendanceOnly)).toBe(true);
  });

  it("reports visit fencing off when it is on but enforces neither end of a visit", () => {
    const c = normalizeGeoFencing({
      enabled: true,
      visit_enabled: true,
      enforce_check_in: false,
      enforce_check_out: false,
    });
    expect(visitFencingOn(c)).toBe(false);
  });
});
