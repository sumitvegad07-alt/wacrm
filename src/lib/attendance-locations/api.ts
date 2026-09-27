// Data access for the Attendance Locations master — the punch-in / punch-out
// geo-fence anchors.
//
// Kept out of the panel component so the queries live in one place and the
// panel stays presentational. Writes run in parallel where they are independent
// (see the 2026-09-15 data-save perf work: sequential round-trips to the
// database, not the database itself, were what made saves feel slow).

import { createClient } from "@/lib/supabase/client";
import type { FenceRadius, FenceScope } from "@/lib/location/geofence-config";

export interface AttendanceLocation {
  id: string;
  account_id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  radius_m: FenceRadius;
  fence_scope: FenceScope;
  applies_to_all: boolean;
  status: "Active" | "Inactive";
  created_at: string;
  /** profiles.id of everyone explicitly assigned. Empty when applies_to_all. */
  assigned_profile_ids: string[];
}

export interface AttendanceLocationInput {
  id?: string;
  account_id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  radius_m: FenceRadius;
  fence_scope: FenceScope;
  applies_to_all: boolean;
  status: "Active" | "Inactive";
  assigned_profile_ids: string[];
  created_by?: string | null;
}

export interface EmployeeOption {
  id: string;
  full_name: string | null;
}

/** Every location in the account, newest first, with its assignment list. */
export async function listAttendanceLocations(accountId: string): Promise<AttendanceLocation[]> {
  const supabase = createClient();
  const [locRes, assignRes] = await Promise.all([
    supabase
      .from("attendance_locations")
      .select("*")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false }),
    supabase
      .from("attendance_location_users")
      .select("location_id, profile_id")
      .eq("account_id", accountId),
  ]);
  if (locRes.error) throw locRes.error;
  // A failed assignment read must not hide the locations themselves; the rows
  // simply show as unassigned until it succeeds.
  const byLocation = new Map<string, string[]>();
  for (const row of assignRes.data ?? []) {
    const list = byLocation.get(row.location_id) ?? [];
    list.push(row.profile_id);
    byLocation.set(row.location_id, list);
  }
  return (locRes.data ?? []).map((l) => ({
    ...(l as Omit<AttendanceLocation, "assigned_profile_ids">),
    assigned_profile_ids: byLocation.get(l.id) ?? [],
  }));
}

/** One location with its assignment list, for the edit form. */
export async function getAttendanceLocation(id: string): Promise<AttendanceLocation | null> {
  const supabase = createClient();
  const [locRes, assignRes] = await Promise.all([
    supabase.from("attendance_locations").select("*").eq("id", id).maybeSingle(),
    supabase.from("attendance_location_users").select("profile_id").eq("location_id", id),
  ]);
  if (locRes.error) throw locRes.error;
  if (!locRes.data) return null;
  return {
    ...(locRes.data as Omit<AttendanceLocation, "assigned_profile_ids">),
    assigned_profile_ids: (assignRes.data ?? []).map((r) => r.profile_id as string),
  };
}

/** Employees who can be assigned to a location. */
export async function listAssignableEmployees(accountId: string): Promise<EmployeeOption[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, status")
    .eq("account_id", accountId)
    .order("full_name");
  if (error) throw error;
  // `status` is null on older rows and means active — the same reading
  // has_permission() applies in SQL.
  return (data ?? [])
    .filter((p) => ((p as { status: string | null }).status ?? "active") === "active")
    .map((p) => ({ id: p.id, full_name: p.full_name }));
}

/**
 * Create or update a location and reconcile its assignment rows.
 *
 * `applies_to_all` wins: when it is on, the per-user rows are cleared, so the
 * two ways of assigning can never disagree about who is fenced.
 */
export async function saveAttendanceLocation(input: AttendanceLocationInput): Promise<string> {
  const supabase = createClient();
  const row = {
    account_id: input.account_id,
    name: input.name.trim(),
    address: input.address?.trim() || null,
    latitude: input.latitude,
    longitude: input.longitude,
    radius_m: input.radius_m,
    fence_scope: input.fence_scope,
    applies_to_all: input.applies_to_all,
    status: input.status,
  };

  let locationId = input.id ?? "";
  if (input.id) {
    const { error } = await supabase.from("attendance_locations").update(row).eq("id", input.id);
    if (error) throw error;
  } else {
    const { data, error } = await supabase
      .from("attendance_locations")
      .insert({ ...row, created_by: input.created_by ?? null })
      .select("id")
      .single();
    if (error) throw error;
    locationId = data.id as string;
  }

  const wanted = input.applies_to_all ? [] : Array.from(new Set(input.assigned_profile_ids));

  // Replace the assignment set. Delete-then-insert rather than a diff: the list
  // is a handful of rows, and a diff is more code to get subtly wrong.
  const { error: delErr } = await supabase
    .from("attendance_location_users")
    .delete()
    .eq("location_id", locationId);
  if (delErr) throw delErr;

  if (wanted.length > 0) {
    const { error: insErr } = await supabase.from("attendance_location_users").insert(
      wanted.map((profile_id) => ({
        location_id: locationId,
        profile_id,
        account_id: input.account_id,
      })),
    );
    if (insErr) throw insErr;
  }

  return locationId;
}

export async function setAttendanceLocationStatus(
  id: string,
  status: "Active" | "Inactive",
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("attendance_locations").update({ status }).eq("id", id);
  if (error) throw error;
}

export async function deleteAttendanceLocation(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("attendance_locations").delete().eq("id", id);
  if (error) throw error;
}
