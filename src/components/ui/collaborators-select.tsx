"use client";

import { useState } from "react";
import { Check, ChevronsUpDown, X, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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

  const toggleProfile = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((item) => item !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  const removeProfile = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(selectedIds.filter((item) => item !== id));
  };

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          disabled={disabled}
          className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-1.5 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 min-h-9 h-auto font-normal text-left"
        >
          <div className="flex flex-wrap gap-1.5 items-center">
            {selectedIds.length === 0 ? (
              <span className="text-muted-foreground text-sm">Select collaborators...</span>
            ) : (
              selectedIds.map((id) => {
                const p = profiles.find((prof) => prof.id === id || prof.user_id === id);
                return (
                  <Badge
                    key={id}
                    variant="secondary"
                    className="text-xs py-0.5 px-2 gap-1 bg-primary/10 text-primary hover:bg-primary/20"
                  >
                    {p?.full_name || p?.email || "User"}
                    <X
                      className="h-3 w-3 cursor-pointer hover:text-destructive"
                      onClick={(e) => removeProfile(id, e)}
                    />
                  </Badge>
                );
              })
            )}
          </div>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50 ml-2" />
        </PopoverTrigger>
        <PopoverContent className="w-[320px] p-2" align="start">
          <div className="space-y-1 max-h-[220px] overflow-y-auto">
            {profiles.length === 0 ? (
              <p className="text-sm text-muted-foreground p-2 text-center">No team members found.</p>
            ) : (
              profiles.map((profile) => {
                const isSelected = selectedIds.includes(profile.id) || selectedIds.includes(profile.user_id);
                const valId = profile.id;
                return (
                  <div
                    key={valId}
                    onClick={() => toggleProfile(valId)}
                    className={cn(
                      "flex items-center justify-between px-2.5 py-2 rounded-md text-sm cursor-pointer transition-colors",
                      isSelected ? "bg-primary/15 text-primary font-medium" : "hover:bg-muted"
                    )}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="truncate">{profile.full_name || profile.email}</span>
                    </div>
                    {isSelected && <Check className="h-4 w-4 shrink-0 text-primary" />}
                  </div>
                );
              })
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
