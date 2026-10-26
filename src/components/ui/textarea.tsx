import * as React from "react"

import { cn } from "@/lib/utils"
import {
  controlSurfaceClassName,
  controlTextClassName,
} from "@/components/ui/control-base"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        controlSurfaceClassName,
        controlTextClassName,
        // No shared height: a textarea grows with its content
        // (`field-sizing-content`). `px-3` matches Input so a full-width
        // textarea lines its text up with the field above it.
        "flex field-sizing-content min-h-24 w-full px-3 py-2 placeholder:text-muted-foreground md:min-h-16",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
