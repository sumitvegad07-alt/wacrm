"use client";

// Territory Master is surfaced under Settings → Territory (not the main menu).
// This route stays for deep-linking and renders the same manager component.
import { TerritoryManager } from "@/components/territories/territory-manager";

export default function TerritoriesPage() {
  return <TerritoryManager />;
}
