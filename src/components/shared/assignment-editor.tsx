"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { Loader2, User as UserIcon } from "lucide-react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { CollaboratorsSelect } from "@/components/ui/collaborators-select";
import { logModuleActivity } from "@/lib/activities";
import type { Profile } from "@/types";

/**
 * Inline owner / collaborators / status editor shown on a record's DETAIL page.
 *
 * Founder decision: owner, collaborators and status are NOT chosen when a lead or
 * deal is created (they default to creator / none / the first status). They are
 * edited here instead, exactly like the reference lead view. Each control
 * auto-saves on change so there is no separate Save step.
 *
 * Owner ids are auth user ids (leads.owner_id / deals.assigned_to are both set to
 * the creator's auth uid). Collaborator ids are profile ids (CollaboratorsSelect's
 * native value), matching how both detail pages resolve them.
 */
export interface AssignmentEditorProps {
  table: "leads" | "deals";
  recordId: string;
  moduleName: "lead" | "deal";
  profiles: Profile[];
  /** Column that stores the owner: "owner_id" (leads) or "assigned_to" (deals). */
  ownerColumn: string;
  /** Current owner — an auth user id. */
  ownerValue: string | null;
  collaboratorIds: string[];
  /** Optional status/stage editor. Omit to hide it (e.g. deals edit stage elsewhere). */
  status?: {
    label: string;
    column: string;
    value: string | null;
    options: { value: string; label: string }[];
    /** Optional inline "Create new" for the status list. */
    onCreate?: (label: string) => Promise<{ value: string; label: string } | null>;
  };
  onSaved?: () => void;
  canEdit?: boolean;
}

export function AssignmentEditor({
  table,
  recordId,
  moduleName,
  profiles,
  ownerColumn,
  ownerValue,
  collaboratorIds,
  status,
  onSaved,
  canEdit = true,
}: AssignmentEditorProps) {
  const supabase = createClient();
  const [owner, setOwner] = useState<string | null>(ownerValue);
  const [collabs, setCollabs] = useState<string[]>(collaboratorIds ?? []);
  const [statusVal, setStatusVal] = useState<string | null>(status?.value ?? null);
  const [savingField, setSavingField] = useState<string | null>(null);

  const ownerOptions = profiles.map((p) => ({
    value: p.user_id,
    label: p.full_name || p.email || "User",
  }));

  async function persist(column: string, value: unknown, field: string, activityMessage?: string) {
    if (!canEdit) return;
    setSavingField(field);
    const { error } = await supabase.from(table).update({ [column]: value }).eq("id", recordId);
    setSavingField(null);
    if (error) {
      toast.error(`Could not update ${field}: ${error.message}`);
      return;
    }
    if (activityMessage) {
      await logModuleActivity(supabase, {
        moduleName,
        recordId,
        action: `${field}_changed`,
        message: activityMessage,
      });
    }
    toast.success(`${field.charAt(0).toUpperCase() + field.slice(1)} updated`);
    onSaved?.();
  }

  return (
    <div className="space-y-4">
      {/* Owner */}
      <div>
        <p className="mb-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
          <UserIcon className="h-4 w-4" /> Owner
          {savingField === "owner" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        </p>
        <SearchableSelect
          value={owner ?? ""}
          onChange={(val) => {
            setOwner(val || null);
            const name = profiles.find((p) => p.user_id === val)?.full_name || "user";
            persist(ownerColumn, val || null, "owner", `Owner changed to ${name}.`);
          }}
          options={ownerOptions}
          placeholder="Unassigned"
          className="bg-muted border-border"
          disabled={!canEdit}
        />
      </div>

      {/* Collaborators */}
      <div>
        <p className="mb-1.5 text-sm text-muted-foreground">Collaborators</p>
        <CollaboratorsSelect
          profiles={profiles}
          selectedIds={collabs}
          disabled={!canEdit}
          onChange={(ids) => {
            setCollabs(ids);
            persist("collaborator_ids", ids, "collaborators");
          }}
        />
      </div>

      {/* Status / Stage (optional) */}
      {status && (
        <div>
          <p className="mb-1.5 text-sm text-muted-foreground">
            {status.label}
            {savingField === "status" && <Loader2 className="ml-1.5 inline h-3.5 w-3.5 animate-spin" />}
          </p>
          <SearchableSelect
            value={statusVal ?? ""}
            onChange={(val) => {
              setStatusVal(val || null);
              const label = status.options.find((o) => o.value === val)?.label || val;
              persist(status.column, val || null, "status", `${status.label} changed to ${label}.`);
            }}
            options={status.options}
            placeholder={`Select ${status.label.toLowerCase()}...`}
            className="bg-muted border-border"
            disabled={!canEdit}
            onCreateOption={status.onCreate}
          />
        </div>
      )}
    </div>
  );
}
