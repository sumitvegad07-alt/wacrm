"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { PERMISSIONS } from "@/lib/auth/permissions-registry";
import { ImportWizard } from "./import-wizard";

interface Props {
  module: string;
  onImported?: () => void;
  label?: string;
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
}

/**
 * Reusable, permission-gated Import trigger. Renders nothing when the user lacks
 * `import_data` (owner/admin always pass). Opens the shared ImportWizard for the
 * given module. Drop it onto any module's toolbar/settings screen.
 */
export function ImportButton({ module, onImported, label = "Import", variant = "outline", size = "sm", className }: Props) {
  const { hasPermission } = useAuth();
  const [open, setOpen] = useState(false);

  if (!hasPermission(PERMISSIONS.IMPORT.DATA)) return null;

  return (
    <>
      <Button variant={variant} size={size} className={className} onClick={() => setOpen(true)}>
        <Upload className="mr-1.5 size-4" /> {label}
      </Button>
      <ImportWizard open={open} onOpenChange={setOpen} module={module} onImported={onImported} />
    </>
  );
}
