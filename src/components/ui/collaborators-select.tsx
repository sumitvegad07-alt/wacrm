"use client";

import { useState } from "react";
import { Check, ChevronsUpDown, X, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import type { Profile } from "@/types";

interface CollaboratorsSelectProps {
  profiles: Profile[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}

export function CollaboratorsSelect({
  profiles,
  selectedIds = [],
  onChange,
  disabled = false,
}: CollaboratorsSelectProps) {
  const [open, setOpen] = useState(false);

  // A stored collaborator id may be a profiles.id OR an auth user_id (rows created
  // by the mobile app / older flows). Treat a profile as selected, and remove it,
  // under EITHER representation so the chip's × and the dropdown always agree.
  const isSelected = (p: Profile) => selectedIds.includes(p.id) || selectedIds.includes(p.user_id);

  const toggleProfile = (p: Profile) => {
    if (isSelected(p)) {
      onChange(selectedIds.filter((id) => id !== p.id && id !== p.user_id));
    } else {
      onChange([...selectedIds, p.id]);
    }
  };

  // Remove by the exact stored id shown on the chip.
  const removeId = (id: string) => onChange(selectedIds.filter((item) => item !== id));

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          disabled={disabled}
          className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-1.5 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 h-9 font-normal text-left"
        >
          <span className={cn("truncate", selectedIds.length === 0 && "text-muted-foreground")}>
            {selectedIds.length === 0
              ? "Select collaborators..."
              : `${selectedIds.length} collaborator${selectedIds.length > 1 ? "s" : ""} selected`}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50 ml-2" />
        </PopoverTrigger>
        <PopoverContent className="w-[320px] p-2" align="start">
          <div className="space-y-1 max-h-[220px] overflow-y-auto">
            {profiles.length === 0 ? (
              <p className="text-sm text-muted-foreground p-2 text-center">No team members found.</p>
            ) : (
              profiles.map((profile) => {
                const selected = isSelected(profile);
                return (
                  <div
                    key={profile.id}
                    onClick={() => toggleProfile(profile)}
                    className={cn(
                      "flex items-center justify-between px-2.5 py-2 rounded-md text-sm cursor-pointer transition-colors",
                      selected ? "bg-primary/15 text-primary font-medium" : "hover:bg-muted",
                    )}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="truncate">{profile.full_name || profile.email}</span>
                    </div>
                    {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
                  </div>
                );
              })
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* Selected chips live OUTSIDE the trigger button: a button cannot legally
          contain another button, and nesting the × inside the trigger meant the
          trigger's pointer-down opened the popover and cancelled the ×'s click,
          so collaborators could not be removed. */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedIds.map((id) => {
            const p = profiles.find((prof) => prof.id === id || prof.user_id === id);
            return (
              <Badge
                key={id}
                variant="secondary"
                className="text-xs py-0.5 pl-2 pr-1 gap-1 bg-primary/10 text-primary"
              >
                {p?.full_name || p?.email || "User"}
                {!disabled && (
                  <button
                    type="button"
                    aria-label="Remove collaborator"
                    onClick={() => removeId(id)}
                    className="rounded-full p-0.5 hover:bg-primary/20 hover:text-destructive focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}
