"use client";

import Link from "next/link";
import { Upload, Boxes, Users, Package, UserPlus, ShoppingCart, Banknote, CheckSquare, MapPin } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { getImportDescriptor } from "@/lib/import/registry";
import { PERMISSIONS } from "@/lib/auth/permissions-registry";

// The full planned import catalogue. Availability is derived live from the
// registry, so a module lights up here the moment its descriptor ships — this
// list never needs a second edit to mark something "available".
const MODULES: { key: string; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "product_units", label: "Product Units", icon: Boxes },
  { key: "contacts", label: "Customers", icon: Users },
  { key: "products", label: "Products", icon: Package },
  { key: "product_categories", label: "Product Categories", icon: Boxes },
  { key: "leads", label: "Leads", icon: UserPlus },
  { key: "orders", label: "Orders", icon: ShoppingCart },
  { key: "outstanding", label: "Outstanding", icon: Banknote },
  { key: "tasks", label: "Tasks", icon: CheckSquare },
  { key: "territories", label: "Territories", icon: MapPin },
  { key: "outstanding", label: "Outstanding", icon: Banknote },
  { key: "stock", label: "Opening Stock", icon: Boxes },
];

export default function ImportHubPage() {
  const { hasPermission } = useAuth();
  const canImport = hasPermission(PERMISSIONS.IMPORT.DATA);

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <Upload className="size-5 text-primary" />
        <h1 className="text-xl font-semibold">Import</h1>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Bulk-add records from a CSV or Excel file. Pick what you want to import — each opens the same guided flow: upload, map columns, preview, confirm.
      </p>

      {!canImport ? (
        <div className="mt-6 rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          You don&apos;t have permission to import. Ask an admin to grant the
          <span className="font-medium text-foreground"> Import Data </span> permission in Team &rarr; Employee Roles.
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m) => {
            const available = !!getImportDescriptor(m.key);
            const Icon = m.icon;
            return (
              <Link
                key={m.key}
                href={`/import/${m.key}`}
                className="group flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/40"
              >
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <Icon className="size-5 text-muted-foreground group-hover:text-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{m.label}</span>
                    {available ? (
                      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                        Available
                      </span>
                    ) : (
                      <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Soon
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {available ? "Ready to import" : "Coming soon"}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
