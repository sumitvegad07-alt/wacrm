import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

/**
 * Horizontal padding here is deliberately NOT responsive.
 *
 * tailwind-merge only drops a base class when the caller's conflicting class
 * carries the same variant, so the old `md:px-2.5` survived alongside a
 * caller's `pl-9` — and Tailwind emits media-query rules after plain ones at
 * equal specificity, so the base won back at >=768px. Every icon-in-input
 * search box in the app therefore collapsed to 10px of left padding on desktop
 * and drew its magnifier straight over the placeholder.
 *
 * Exported so input-padding.test.ts can assert on exactly what ships.
 */
export const inputBaseClassName =
  "h-11 md:h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-3 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(inputBaseClassName, className)}
      {...props}
    />
  )
}

export { Input }
