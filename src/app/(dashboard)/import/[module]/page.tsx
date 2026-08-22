"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Upload, History, Clock } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { getImportDescriptor } from "@/lib/import/registry";
import { PERMISSIONS } from "@/lib/auth/permissions-registry";
import { Button } from "@/components/ui/button";
import { ImportWizard } from "@/components/import/import-wizard";
import { ImportHistoryDialog } from "@/components/import/import-history-dialog";

// Human labels for planned-but-not-yet-built modules, so the coming-soon page
// still reads nicely. Built modules take their label from the descriptor.
const PLANNED_LABELS: Record<string, string> = {
  contacts: "Customers",
  products: "Products",
  product_categories: "Product Categories",
  leads: "Leads",
  orders: "Orders",
  outstanding: "Outstanding",
  tasks: "Tasks",
  territories: "Territories",
  price_lists: "Price Lists",
};

export default function ModuleImportPage() {
  const params = useParams<{ module: string }>();
  const moduleKey = params?.module ?? "";
  const { hasPermission } = useAuth();
  const descriptor = getImportDescriptor(moduleKey);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const canImport = hasPermission(PERMISSIONS.IMPORT.DATA);
  const label = descriptor?.label ?? PLANNED_LABELS[moduleKey] ?? "This module";

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <Link href="/import" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All imports
      </Link>

      <h1 className="text-xl font-semibold">Import {label}</h1>

      {!canImport ? (
        <div className="mt-6 rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          You don&apos;t have permission to import. Ask an admin to grant you the
          <span className="font-medium text-foreground"> Import Data </span> permission in Team &rarr; Employee Roles.
        </div>
      ) : !descriptor ? (
        <div className="mt-6 rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <Clock className="mx-auto mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">{label} import is coming soon</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            The Universal Import engine is live and this module is next in line. It will appear here the moment it&apos;s enabled — no new screen to learn.
          </p>
        </div>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload a CSV or Excel file to bulk-add {label.toLowerCase()}. You&apos;ll map columns, preview, and confirm before anything is saved.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button onClick={() => setWizardOpen(true)}>
              <Upload className="mr-1.5 size-4" /> Start import
            </Button>
            <Button variant="outline" onClick={() => setHistoryOpen(true)}>
              <History className="mr-1.5 size-4" /> Import history
            </Button>
          </div>

          <ImportWizard open={wizardOpen} onOpenChange={setWizardOpen} module={moduleKey} />
          <ImportHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} module={moduleKey} />
        </>
      )}
    </div>
  );
}
