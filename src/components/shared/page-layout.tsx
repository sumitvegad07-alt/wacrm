"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface PageLayoutProps extends React.ComponentProps<"div"> {
  /**
   * Optional custom spacing between page sections. Defaults to space-y-6 (24px).
   */
  spacing?: "default" | "tight" | "loose" | "none";
}

/**
 * Enterprise PageLayout container.
 * Enforces identical maximum width (1440px), horizontal padding (px-4 sm:px-6),
 * and vertical rhythm across every module page in the application.
 */
export function PageLayout({
  className,
  spacing = "default",
  children,
  ...props
}: PageLayoutProps) {
  const spacingMap = {
    default: "space-y-3",
    tight: "space-y-2",
    loose: "space-y-6",
    none: "",
  };

  return (
    <div
      data-slot="page-layout"
      className={cn(
        "mx-auto w-full max-w-[1440px] px-4 sm:px-6 py-3",
        spacingMap[spacing],
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
