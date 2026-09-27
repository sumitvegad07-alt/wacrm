"use client";

// Attendance Locations — the master behind geo-fenced punch in / punch out.
//
// Each row is a place a rep is allowed to mark attendance from: a pin, a radius,
// which punch events it fences, and who it applies to. The fence itself is
// applied on the phone (instant, works offline) and re-checked by a database
// trigger; this screen is only where the anchors are defined.
//
// Two rules worth keeping in mind while reading:
//   - A user with no location covering an event punches from anywhere. That is
//     deliberate: enabling the feature must not lock a workforce out.
//   - `applies_to_all` wins over the per-user list, so the two can never
//     disagree about who is fenced.

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { MultiSelect } from "@/components/ui/multi-select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Crosshair,
  Edit2,
  Loader2,
  MapPin,
  Plus,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import {
  FENCE_RADII,
  FENCE_SCOPE_LABEL,
  readGeoFencing,
  type FenceRadius,
  type FenceScope,
} from "@/lib/location/geofence-config";
import {
  deleteAttendanceLocation,
  listAssignableEmployees,
  listAttendanceLocations,
  saveAttendanceLocation,
  setAttendanceLocationStatus,
  type AttendanceLocation,
  type EmployeeOption,
} from "@/lib/attendance-locations/api";
import { geocode, reverseGeocode } from "@/lib/geo-service";

// Leaflet touches `window` at import time, so the picker can never be server-rendered.
const LocationMapPicker = dynamic(
  () => import("@/components/settings/attendance-locations/location-map-picker"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-64 w-full items-center justify-center rounded-md border border-border bg-muted/30 text-sm text-muted-foreground">
        Loading map…
      </div>
    ),
  },
);

/** Ahmedabad — where the map opens when the tenant has pinned nothing yet. */
const FALLBACK_CENTRE = { lat: 23.0225, lng: 72.5714 };

const SCOPE_OPTIONS: FenceScope[] = ["punch_in", "punch_out", "both"];

interface FormState {
  id?: string;
  name: string;
  address: string;
  lat: string;
  lng: string;
  radius_m: FenceRadius;
  fence_scope: FenceScope;
  applies_to_all: boolean;
  assigned: string[];
  status: "Active" | "Inactive";
}

function emptyForm(centre: { lat: number; lng: number }): FormState {
  return {
    name: "",
    address: "",
    lat: centre.lat.toFixed(6),
    lng: centre.lng.toFixed(6),
    radius_m: 100,
    fence_scope: "both",
    applies_to_all: false,
    assigned: [],
    status: "Active",
  };
}

export function AttendanceLocationsSettings() {
  const { accountId, account, profile, hasPermission } = useAuth();

  const canCreate = hasPermission("create_attendance_locations");
  const canEdit = hasPermission("edit_attendance_locations");
  const canDelete = hasPermission("delete_attendance_locations");

  // Whether the fence is actually switched on. The master is still editable when
  // it is off — an admin will normally set the locations up first — but saying so
  // up front avoids "I added it and nothing happened".
  const fencing = useMemo(() => readGeoFencing(account?.settings), [account?.settings]);
  const attendanceFenceLive = fencing.enabled && fencing.attendance_enabled;

  const [locations, setLocations] = useState<AttendanceLocation[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() => emptyForm(FALLBACK_CENTRE));
  const [confirmDelete, setConfirmDelete] = useState<AttendanceLocation | null>(null);

  // Address search + reverse geocode state.
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  // Bumped whenever the coordinates change from OUTSIDE the map, so the picker
  // knows to recentre (and not to fight an admin who is panning it).
  const [recentreKey, setRecentreKey] = useState(0);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const [locs, emps] = await Promise.all([
        listAttendanceLocations(accountId),
        listAssignableEmployees(accountId),
      ]);
      setLocations(locs);
      setEmployees(emps);
    } catch {
      // The most likely cause on a fresh deploy is the migration not being applied yet.
      toast.error("Could not load attendance locations");
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  const employeeOptions = useMemo(
    () => employees.map((e) => ({ label: e.full_name || "Unnamed user", value: e.id })),
    [employees],
  );
  const nameById = useMemo(
    () => new Map(employees.map((e) => [e.id, e.full_name || "Unnamed user"])),
    [employees],
  );

  /** Where a new location's map should open: near an existing pin, else Ahmedabad. */
  const defaultCentre = useMemo(() => {
    const first = locations[0];
    return first ? { lat: first.latitude, lng: first.longitude } : FALLBACK_CENTRE;
  }, [locations]);

  const openCreate = () => {
    setForm(emptyForm(defaultCentre));
    setSearchQuery("");
    setRecentreKey(0);
    setDialogOpen(true);
  };

  const openEdit = (l: AttendanceLocation) => {
    setForm({
      id: l.id,
      name: l.name,
      address: l.address ?? "",
      lat: l.latitude.toFixed(6),
      lng: l.longitude.toFixed(6),
      radius_m: l.radius_m,
      fence_scope: l.fence_scope,
      applies_to_all: l.applies_to_all,
      assigned: l.assigned_profile_ids,
      status: l.status,
    });
    setSearchQuery("");
    setRecentreKey(0);
    setDialogOpen(true);
  };

  const parsedLat = Number(form.lat);
  const parsedLng = Number(form.lng);
  const coordsValid =
    Number.isFinite(parsedLat) &&
    Number.isFinite(parsedLng) &&
    Math.abs(parsedLat) <= 90 &&
    Math.abs(parsedLng) <= 180;

  const setPin = (lat: number, lng: number, fromOutsideMap: boolean) => {
    setForm((f) => ({ ...f, lat: lat.toFixed(6), lng: lng.toFixed(6) }));
    if (fromOutsideMap) setRecentreKey((k) => k + 1);
  };

  /** Search an address and drop the pin on the first hit. */
  const runSearch = async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    try {
      const hits = await geocode(q);
      if (hits.length === 0) {
        toast.error("No place found for that search");
        return;
      }
      setPin(hits[0].lat, hits[0].lng, true);
      setForm((f) => ({ ...f, address: f.address.trim() || hits[0].displayName }));
    } catch {
      toast.error("Address lookup failed");
    } finally {
      setSearching(false);
    }
  };

  /** Pin the admin's own position — the quickest way to register the office you are sitting in. */
  const useMyLocation = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast.error("This browser cannot report a location");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setPin(pos.coords.latitude, pos.coords.longitude, true);
        try {
          const rev = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
          if (rev?.address) {
            setForm((f) => ({ ...f, address: f.address.trim() || rev.address }));
          }
        } catch {
          // An address is a nicety; the coordinates are what matter.
        }
        setLocating(false);
      },
      () => {
        toast.error("Could not read your location. Allow location access, or search the address.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const handleSave = async () => {
    if (!accountId) return;
    if (!form.name.trim()) {
      toast.error("Give the location a name");
      return;
    }
    if (!coordsValid) {
      toast.error("Drop a pin on the map, or enter valid coordinates");
      return;
    }
    if (!form.applies_to_all && form.assigned.length === 0) {
      toast.error("Assign at least one user, or turn on “Applies to all users”");
      return;
    }
    setSaving(true);
    try {
      await saveAttendanceLocation({
        id: form.id,
        account_id: accountId,
        name: form.name,
        address: form.address,
        latitude: parsedLat,
        longitude: parsedLng,
        radius_m: form.radius_m,
        fence_scope: form.fence_scope,
        applies_to_all: form.applies_to_all,
        status: form.status,
        assigned_profile_ids: form.assigned,
        created_by: profile?.id ?? null,
      });
      toast.success(form.id ? "Location updated" : "Location added");
      setDialogOpen(false);
      void load();
    } catch (err) {
      const code = (err as { code?: string })?.code;
      toast.error(
        code === "23505"
          ? "A location with that name already exists"
          : "Could not save the location",
      );
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (l: AttendanceLocation) => {
    const next = l.status === "Active" ? "Inactive" : "Active";
    try {
      await setAttendanceLocationStatus(l.id, next);
      toast.success(
        next === "Inactive"
          ? `${l.name} no longer fences anyone`
          : `${l.name} is fencing again`,
      );
      void load();
    } catch {
      toast.error("Could not update the status");
    }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    try {
      await deleteAttendanceLocation(confirmDelete.id);
      toast.success("Location deleted");
      setConfirmDelete(null);
      void load();
    } catch {
      toast.error("Could not delete the location");
    }
  };

  return (
    <div className="w-full space-y-6 animate-in fade-in-50 duration-200">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-medium">Attendance Locations</h3>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Where your team is allowed to punch in and out. A user with no location assigned can
            punch from anywhere, so nobody is ever locked out of their own attendance.
          </p>
        </div>
        {canCreate && (
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> Add Location
          </Button>
        )}
      </div>

      {!attendanceFenceLive && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-600 dark:text-amber-400">
          Attendance geo-fencing is switched off, so these locations fence nobody yet. Turn on{" "}
          <span className="font-medium">Geo-Fencing → Geo-Fencing for Attendance</span> in{" "}
          <Link href="/settings?tab=module_settings" className="underline">
            Organization Settings
          </Link>{" "}
          when you are ready.
        </div>
      )}

      <div className="overflow-hidden rounded-md border bg-card">
        {loading ? (
          <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading locations…
          </div>
        ) : locations.length === 0 ? (
          <div className="flex flex-col items-center p-8 text-center text-muted-foreground">
            <MapPin className="mb-2 h-10 w-10 opacity-50" />
            <p>No attendance locations yet.</p>
            <p className="mt-1 text-xs">
              Add your office and your team will only be able to punch there.
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {locations.map((l) => (
              <div
                key={l.id}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{l.name}</span>
                    <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                      {l.radius_m >= 1000 ? `${l.radius_m / 1000} km` : `${l.radius_m} m`}
                    </span>
                    <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                      {FENCE_SCOPE_LABEL[l.fence_scope]}
                    </span>
                    {l.status === "Inactive" && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                        Inactive
                      </span>
                    )}
                  </div>
                  {l.address && (
                    <p className="mt-1 truncate text-xs text-muted-foreground">{l.address}</p>
                  )}
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <Users className="h-3 w-3" />
                    {l.applies_to_all
                      ? "All users"
                      : l.assigned_profile_ids.length === 0
                        ? "Nobody assigned — fences nobody"
                        : l.assigned_profile_ids.length <= 3
                          ? l.assigned_profile_ids.map((id) => nameById.get(id) ?? "—").join(", ")
                          : `${l.assigned_profile_ids.length} users`}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground/70">
                    {l.latitude.toFixed(5)}, {l.longitude.toFixed(5)}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {canEdit && (
                    <>
                      <Switch
                        checked={l.status === "Active"}
                        onCheckedChange={() => void toggleStatus(l)}
                        aria-label={`Toggle ${l.name}`}
                      />
                      <Button variant="ghost" size="icon" onClick={() => openEdit(l)} aria-label="Edit">
                        <Edit2 className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                  {canDelete && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setConfirmDelete(l)}
                      aria-label="Delete"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Add / edit ───────────────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit Attendance Location" : "Add Attendance Location"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  placeholder="e.g. Head Office"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Address (optional)</Label>
                <Input
                  placeholder="For your own reference"
                  value={form.address}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Find the place</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Search an address or landmark"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void runSearch();
                    }
                  }}
                />
                <Button variant="outline" onClick={() => void runSearch()} disabled={searching}>
                  {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </Button>
                <Button variant="outline" onClick={useMyLocation} disabled={locating}>
                  {locating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Crosshair className="h-4 w-4" />
                  )}
                  <span className="ml-1 hidden sm:inline">Use my location</span>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Or click the map / drag the pin. The circle is the allowed radius.
              </p>
            </div>

            {coordsValid && (
              <LocationMapPicker
                lat={parsedLat}
                lng={parsedLng}
                radiusM={form.radius_m}
                onPick={(lat, lng) => setPin(lat, lng, false)}
                recentreKey={recentreKey}
              />
            )}

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Latitude</Label>
                <Input
                  value={form.lat}
                  onChange={(e) => setForm((f) => ({ ...f, lat: e.target.value }))}
                  onBlur={() => setRecentreKey((k) => k + 1)}
                />
              </div>
              <div className="space-y-2">
                <Label>Longitude</Label>
                <Input
                  value={form.lng}
                  onChange={(e) => setForm((f) => ({ ...f, lng: e.target.value }))}
                  onBlur={() => setRecentreKey((k) => k + 1)}
                />
              </div>
              <div className="space-y-2">
                <Label>Allowed radius</Label>
                <select
                  value={form.radius_m}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, radius_m: Number(e.target.value) as FenceRadius }))
                  }
                  aria-label="Allowed radius"
                  className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground"
                >
                  {FENCE_RADII.map((r) => (
                    <option key={r} value={r}>
                      {r >= 1000 ? `${r / 1000} km (${r} m)` : `${r} m`}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {!coordsValid && (
              <p className="text-xs text-destructive">
                Those coordinates aren&apos;t valid, so the map is hidden. Search the address or use
                your location.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              The phone&apos;s GPS accuracy is added to the radius automatically (up to 100 m) so
              honest reps aren&apos;t wrongly blocked.
            </p>

            <div className="space-y-2">
              <Label>This location fences</Label>
              <select
                value={form.fence_scope}
                onChange={(e) =>
                  setForm((f) => ({ ...f, fence_scope: e.target.value as FenceScope }))
                }
                aria-label="Fenced events"
                className="h-9 w-full max-w-xs rounded-md border border-border bg-background px-2 text-sm text-foreground"
              >
                {SCOPE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {FENCE_SCOPE_LABEL[s]}
                  </option>
                ))}
              </select>
              {form.fence_scope !== "punch_in" && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                  This fences punch-out too. A rep who ends the day away from here won&apos;t be able
                  to punch out — pick “Punch In only” for field staff who finish in the field.
                </div>
              )}
            </div>

            <div className="space-y-3 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-foreground">Applies to all users</p>
                  <p className="text-xs text-muted-foreground">
                    Everyone in the account may punch here. Leave off to choose specific people.
                  </p>
                </div>
                <Switch
                  checked={form.applies_to_all}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, applies_to_all: Boolean(v) }))}
                  aria-label="Applies to all users"
                />
              </div>

              {!form.applies_to_all && (
                <div className="space-y-2">
                  <Label>Assigned users</Label>
                  <MultiSelect
                    options={employeeOptions}
                    selectedValues={form.assigned}
                    onChange={(v) => setForm((f) => ({ ...f, assigned: v }))}
                    placeholder="Choose who punches here"
                    emptyMessage="No users found."
                    searchable
                  />
                  <p className="text-xs text-muted-foreground">
                    A user may be assigned to several locations and can punch at any of them.
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">Active</p>
                <p className="text-xs text-muted-foreground">
                  An inactive location fences nobody and keeps its history.
                </p>
              </div>
              <Switch
                checked={form.status === "Active"}
                onCheckedChange={(v) =>
                  setForm((f) => ({ ...f, status: v ? "Active" : "Inactive" }))
                }
                aria-label="Active"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void handleSave()} disabled={saving}>
                {saving ? "Saving…" : form.id ? "Save changes" : "Add location"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation ──────────────────────────────────────── */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete “{confirmDelete?.name}”?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Reps assigned only to this location will be able to punch from anywhere. Past punches
            keep their record. Set it to Inactive instead if you may want it back.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <button
              type="button"
              onClick={() => void doDelete()}
              className={buttonVariants({ variant: "destructive" })}
            >
              Delete
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
