"use client";

// Territory Master is surfaced under Settings → Territory (not the main menu).
// This route stays for deep-linking and renders the same manager component.
import { TerritoryManager } from "@/components/territories/territory-manager";
import { RequirePermission } from "@/components/auth/require-permission";

export default function TerritoriesPage() {
  return (
    <RequirePermission permission="edit_territories">
      <TerritoryManager />
    </RequirePermission>
  );
}
