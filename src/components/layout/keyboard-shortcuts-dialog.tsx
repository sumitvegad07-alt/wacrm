"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { APP_SHORTCUTS } from "@/lib/shortcuts";

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-6 items-center justify-center rounded-md border border-border bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground shadow-sm">
      {children}
    </kbd>
  );
}

export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Work faster across the app. Shortcuts act on the current page.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-1 divide-y divide-border">
          {APP_SHORTCUTS.map((s) => (
            <div
              key={s.action}
              className="flex items-center justify-between gap-4 py-2"
            >
              <span className="text-sm text-foreground">{s.label}</span>
              <span className="flex items-center gap-1">
                {s.keys.map((k, i) => (
                  <Key key={i}>{k}</Key>
                ))}
              </span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
