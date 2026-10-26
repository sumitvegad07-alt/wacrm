"use client";

import { Printer } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

/**
 * Print button with a paper choice behind it.
 *
 * Opens a new tab per size rather than printing in place, which keeps the
 * browser's own print preview in the loop — that is where people pick their
 * printer and choose Save as PDF.
 */
export function PrintSizeMenu({
  href,
  label = "Print",
  variant = "outline",
}: {
  /** The print route, without a `size` parameter. */
  href: string;
  label?: string;
  variant?: "outline" | "default" | "ghost";
}) {
  const open = (size: "a4" | "a5") => {
    const url = href.includes("?") ? `${href}&size=${size}` : `${href}?size=${size}`;
    window.open(url, "_blank", "noopener");
  };

  return (
    <DropdownMenu>
      {/* `render`, not `asChild` — this menu is Base UI, where asChild does
          not exist and fails the typecheck. */}
      <DropdownMenuTrigger
        render={
          <Button variant={variant} size="sm" className="gap-2">
            <Printer className="size-4" />
            {label}
          </Button>
        }
      />
      {/* No DropdownMenuLabel here: this menu is Base UI, and a Label outside a
          Group throws "MenuGroupContext is missing" and takes the page down. */}
      <DropdownMenuContent align="end" className="w-40 text-xs">
        <DropdownMenuItem onClick={() => open("a4")} className="cursor-pointer">
          Print on A4
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => open("a5")} className="cursor-pointer">
          Print on A5
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
