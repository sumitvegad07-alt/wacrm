import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"
import {
  controlHeightClassName,
  controlSurfaceClassName,
  controlTextClassName,
} from "@/components/ui/control-base"

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
 *
 * Height, surface and text size come from ui/control-base so this field and
 * the searchable dropdown beside it in a form row are the same control.
 */
export const inputBaseClassName = cn(
  controlSurfaceClassName,
  controlHeightClassName,
  controlTextClassName,
  "w-full min-w-0 px-3 py-1 placeholder:text-muted-foreground file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground"
)

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
