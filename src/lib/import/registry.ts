import type { ImportDescriptor } from "./types";
import { productUnitsDescriptor } from "./descriptors/product-units";
import { WAVE1_DESCRIPTORS } from "./descriptors/masters";

// Central registry: module key -> descriptor. Adding a module to the import
// framework = registering its descriptor here (and adding the matching branch to
// the import_commit / import_undo RPCs). Mirrors the report-engine registry pattern.
const DESCRIPTORS: Record<string, ImportDescriptor> = Object.fromEntries(
  [productUnitsDescriptor, ...WAVE1_DESCRIPTORS].map((d) => [d.module, d]),
);

export function getImportDescriptor(module: string): ImportDescriptor | null {
  return DESCRIPTORS[module] ?? null;
}

export function isImportModule(module: string): boolean {
  return module in DESCRIPTORS;
}

export function listImportModules(): ImportDescriptor[] {
  return Object.values(DESCRIPTORS);
}
