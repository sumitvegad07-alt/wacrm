"use client";

// Create / edit an Attendance Location.
//
// A full-page master built on the shared FormPageShell + FormSection +
// FormActions, so it reads and behaves exactly like Customer and Product
// creation rather than being squeezed into a dialog.
//
// The map is the one non-standard control here, and it earns its place: "100 m"
// means nothing until the admin sees the circle miss the factory gate.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useAuth } from "@/hooks/use-auth";
import { FormActions, FormPageShell, FormSection } from "@/components/shared";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { MultiSelect } from "@/components/ui/multi-select";
import { toast } from "sonner";
import { MapPin } from "lucide-react";
import {
  FENCE_RADII,
  FENCE_SCOPE_LABEL,
  type FenceRadius,
  type FenceScope,
} from "@/lib/location/geofence-config";
import {
  getAttendanceLocation,
  listAssignableEmployees,
  listAttendanceLocations,
  saveAttendanceLocation,
  type EmployeeOption,
} from "@/lib/attendance-locations/api";

// Leaflet touches `window` at import time, so the picker can never be server-rendered.
const LocationMapPicker = dynamic(
  () => import("@/components/settings/attendance-locations/location-map-picker"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-72 w-full items-center justify-center rounded-md border border-border bg-muted/30 text-sm text-muted-foreground">
        Loading map…
      </div>
    ),
  },
);

/** Where the map opens when the account has pinned nothing yet. */
const FALLBACK_CENTRE = { lat: 23.0225, lng: 72.5714 };

const SCOPE_OPTIONS: FenceScope[] = ["punch_in", "punch_out", "both"];

const LIST_HREF = "/settings?tab=attendance_locations";

export function AttendanceLocationForm({ locationId }: { locationId?: string }) {
  const router = useRouter();
  const { accountId, profile } = useAuth();
  const isEdit = Boolean(locationId);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState(FALLBACK_CENTRE.lat.toFixed(6));
  const [lng, setLng] = useState(FALLBACK_CENTRE.lng.toFixed(6));
  const [radiusM, setRadiusM] = useState<FenceRadius>(100);
  const [fenceScope, setFenceScope] = useState<FenceScope>("both");
  const [appliesToAll, setAppliesToAll] = useState(false);
  const [assigned, setAssigned] = useState<string[]>([]);
  const [status, setStatus] = useState<"Active" | "Inactive">("Active");
  // Bumped when the coordinates change from outside the map (typed in), so the
  // picker recentres instead of fighting an admin who is panning it.
  const [recentreKey, setRecentreKey] = useState(0);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const [emps, existing, all] = await Promise.all([
        listAssignableEmployees(accountId),
        locationId ? getAttendanceLocation(locationId) : Promise.resolve(null),
        // Only needed to centre a NEW location's map near an existing one.
        locationId ? Promise.resolve([]) : listAttendanceLocations(accountId),
      ]);
      setEmployees(emps);
      if (existing) {
        setName(existing.name);
        setAddress(existing.address ?? "");
        setLat(existing.latitude.toFixed(6));
        setLng(existing.longitude.toFixed(6));
        setRadiusM(existing.radius_m);
        setFenceScope(existing.fence_scope);
        setAppliesToAll(existing.applies_to_all);
        setAssigned(existing.assigned_profile_ids);
        setStatus(existing.status);
      } else if (all.length > 0) {
        setLat(all[0].latitude.toFixed(6));
        setLng(all[0].longitude.toFixed(6));
      }
    } catch {
      toast.error("Could not load this location");
    } finally {
      setLoading(false);
    }
  }, [accountId, locationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const employeeOptions = useMemo(
    () => employees.map((e) => ({ label: e.full_name || "Unnamed user", value: e.id })),
    [employees],
  );

  const parsedLat = Number(lat);
  const parsedLng = Number(lng);
  const coordsValid =
    Number.isFinite(parsedLat) &&
    Number.isFinite(parsedLng) &&
    Math.abs(parsedLat) <= 90 &&
    Math.abs(parsedLng) <= 180;

  const goBack = () => router.push(LIST_HREF);

  const handleSave = async () => {
    if (!accountId) return;
    if (!name.trim()) {
      toast.error("Give the location a name");
      return;
    }
    if (!coordsValid) {
      toast.error("Drop a pin on the map, or enter valid coordinates");
      return;
    }
    if (!appliesToAll && assigned.length === 0) {
      toast.error("Assign at least one user, or turn on “Applies to all users”");
      return;
    }
    setSaving(true);
    try {
      await saveAttendanceLocation({
        id: locationId,
        account_id: accountId,
        name,
        address,
        latitude: parsedLat,
        longitude: parsedLng,
        radius_m: radiusM,
        fence_scope: fenceScope,
        applies_to_all: appliesToAll,
        status,
        assigned_profile_ids: assigned,
        created_by: profile?.id ?? null,
      });
      toast.success(isEdit ? "Location updated" : "Location added");
      router.push(LIST_HREF);
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

  // 4 columns on wide screens, exactly like the full-page Customer / Product forms.
  const fieldGrid = "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-x-4 gap-y-4";

  return (
    <FormPageShell
      icon={MapPin}
      title={isEdit ? "Edit Attendance Location" : "Add Attendance Location"}
      subtitle="Where your team is allowed to punch in and out"
      onBack={goBack}
      footer={
        <FormActions
          onCancel={goBack}
          onSave={() => void handleSave()}
          saving={saving}
          saveDisabled={loading}
          saveLabel={isEdit ? "Save changes" : "Add location"}
        />
      }
    >
      {loading ? (
        <div className="space-y-4" aria-hidden="true">
          <div className="h-4 w-40 rounded bg-muted animate-pulse" />
          <div className={fieldGrid}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <div className="h-3 w-24 rounded bg-muted animate-pulse" />
                <div className="h-9 w-full rounded bg-muted animate-pulse" />
              </div>
            ))}
          </div>
          <div className="h-72 w-full rounded bg-muted animate-pulse" />
        </div>
      ) : (
        <div className="space-y-6">
          <FormSection title="Location Details">
            <div className={fieldGrid}>
              <div className="space-y-2">
                <Label>
                  Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  placeholder="e.g. Head Office"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Address</Label>
                <Input
                  placeholder="For your own reference"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <div className="flex h-9 items-center gap-3">
                  <Switch
                    checked={status === "Active"}
                    onCheckedChange={(v) => setStatus(v ? "Active" : "Inactive")}
                    aria-label="Active"
                  />
                  <span className="text-sm text-muted-foreground">
                    {status === "Active" ? "Active" : "Inactive — fences nobody"}
                  </span>
                </div>
              </div>
            </div>
          </FormSection>

          <FormSection
            title="Position & Radius"
            subtitle="Click the map or drag the pin. The circle is the allowed radius."
          >
            <div className={fieldGrid}>
              <div className="space-y-2">
                <Label>
                  Latitude <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                  onBlur={() => setRecentreKey((k) => k + 1)}
                />
              </div>
              <div className="space-y-2">
                <Label>
                  Longitude <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={lng}
                  onChange={(e) => setLng(e.target.value)}
                  onBlur={() => setRecentreKey((k) => k + 1)}
                />
              </div>
              <div className="space-y-2">
                <Label>Allowed radius</Label>
                <select
                  value={radiusM}
                  onChange={(e) => setRadiusM(Number(e.target.value) as FenceRadius)}
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

            {coordsValid ? (
              <LocationMapPicker
                lat={parsedLat}
                lng={parsedLng}
                radiusM={radiusM}
                onPick={(pLat, pLng) => {
                  setLat(pLat.toFixed(6));
                  setLng(pLng.toFixed(6));
                }}
                recentreKey={recentreKey}
              />
            ) : (
              <p className="text-xs text-destructive">
                Those coordinates aren&apos;t valid, so the map is hidden. Correct them to carry on.
              </p>
            )}

            <p className="text-xs text-muted-foreground">
              The phone&apos;s GPS accuracy is added to the radius automatically (up to 100 m), so
              honest reps aren&apos;t wrongly blocked.
            </p>
          </FormSection>

          <FormSection
            title="Fencing"
            subtitle="Which punch this location applies to"
          >
            <div className={fieldGrid}>
              <div className="space-y-2">
                <Label>This location fences</Label>
                <select
                  value={fenceScope}
                  onChange={(e) => setFenceScope(e.target.value as FenceScope)}
                  aria-label="Fenced events"
                  className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground"
                >
                  {SCOPE_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {FENCE_SCOPE_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {fenceScope !== "punch_in" && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                This fences punch-out too. A rep who ends the day away from here won&apos;t be able
                to punch out — choose “Punch In only” for field staff who finish in the field.
              </div>
            )}
          </FormSection>

          <FormSection title="Who It Applies To">
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">Applies to all users</p>
                <p className="text-xs text-muted-foreground">
                  Everyone in the account may punch here. Leave off to choose specific people.
                </p>
              </div>
              <Switch
                checked={appliesToAll}
                onCheckedChange={(v) => setAppliesToAll(Boolean(v))}
                aria-label="Applies to all users"
              />
            </div>

            {!appliesToAll && (
              <div className="space-y-2">
                <Label>Assigned users</Label>
                <MultiSelect
                  options={employeeOptions}
                  selectedValues={assigned}
                  onChange={setAssigned}
                  placeholder="Choose who punches here"
                  emptyMessage="No users found."
                  searchable
                />
                <p className="text-xs text-muted-foreground">
                  A user may be assigned to several locations and can punch at any of them. Anyone
                  with no location assigned keeps punching from anywhere.
                </p>
              </div>
            )}
          </FormSection>
        </div>
      )}
    </FormPageShell>
  );
}
