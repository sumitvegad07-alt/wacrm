"use client";

// Attendance Locations — the master behind geo-fenced punch in / punch out.
//
// Each row is a place a rep is allowed to mark attendance from: a pin, a radius,
// which punch events it fences, and who it applies to. The fence itself is
// applied on the phone (instant, works offline) and re-checked by a database
// trigger; this screen is only where the anchors are defined.
//
// This is the LIST. Create / edit happen on their own full pages
// (/settings/attendance-locations/new and /[id]/edit) so the form matches
// Customer and Product creation instead of living in a cramped dialog.
//
// Two rules worth keeping in mind while reading:
//   - A user with no location covering an event punches from anywhere. That is
//     deliberate: enabling the feature must not lock a workforce out.
//   - `applies_to_all` wins over the per-user list, so the two can never
//     disagree about who is fenced.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { Button, buttonVariants } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/shared";
import { toast } from "sonner";
import { Edit2, Loader2, MapPin, Plus, Trash2, Users } from "lucide-react";
import { FENCE_SCOPE_LABEL, readGeoFencing } from "@/lib/location/geofence-config";
import {
  deleteAttendanceLocation,
  listAssignableEmployees,
  listAttendanceLocations,
  setAttendanceLocationStatus,
  type AttendanceLocation,
  type EmployeeOption,
} from "@/lib/attendance-locations/api";

export function AttendanceLocationsSettings() {
  const { accountId, account, hasPermission } = useAuth();

  const canCreate = hasPermission("create_attendance_locations");
  const canEdit = hasPermission("edit_attendance_locations");
  const canDelete = hasPermission("delete_attendance_locations");

  // Whether the fence is actually switched on. The master stays editable when it
  // is off — an admin will normally set the locations up first — but saying so up
  // front avoids "I added it and nothing happened".
  const fencing = useMemo(() => readGeoFencing(account?.settings), [account?.settings]);
  const attendanceFenceLive = fencing.enabled && fencing.attendance_enabled;

  const [locations, setLocations] = useState<AttendanceLocation[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<AttendanceLocation | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  const nameById = useMemo(
    () => new Map(employees.map((e) => [e.id, e.full_name || "Unnamed user"])),
    [employees],
  );

  const toggleStatus = async (l: AttendanceLocation) => {
    const next = l.status === "Active" ? "Inactive" : "Active";
    try {
      await setAttendanceLocationStatus(l.id, next);
      toast.success(
        next === "Inactive" ? `${l.name} no longer fences anyone` : `${l.name} is fencing again`,
      );
      void load();
    } catch {
      toast.error("Could not update the status");
    }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await deleteAttendanceLocation(confirmDelete.id);
      toast.success("Location deleted");
      setConfirmDelete(null);
      void load();
    } catch {
      toast.error("Could not delete the location");
    } finally {
      setDeleting(false);
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
          <Link
            href="/settings/attendance-locations/new"
            className={buttonVariants({ variant: "default" })}
          >
            <Plus className="mr-2 h-4 w-4" /> Add Location
          </Link>
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
                      <Link
                        href={`/settings/attendance-locations/${l.id}/edit`}
                        className={buttonVariants({ variant: "ghost", size: "icon" })}
                        aria-label={`Edit ${l.name}`}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Link>
                    </>
                  )}
                  {canDelete && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setConfirmDelete(l)}
                      aria-label={`Delete ${l.name}`}
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

      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title="Delete attendance location"
        description={
          <>
            Reps assigned only to <span className="font-medium">{confirmDelete?.name}</span> will be
            able to punch from anywhere. Past punches keep their record. Set it to Inactive instead
            if you may want it back.
          </>
        }
        confirmLabel="Delete"
        variant="danger"
        loading={deleting}
        onConfirm={() => void doDelete()}
      />
    </div>
  );
}
