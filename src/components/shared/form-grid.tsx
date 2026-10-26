import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The field grid for a full-page create/edit form.
 *
 * One column on a phone, two from `sm`, three from `xl`, four from `2xl` —
 * which is what every "as page" form in the app already used. It was just
 * copy-pasted into six files as a literal string instead of imported, and the
 * constant that was supposed to be canonical
 * (`custom-fields-section-renderer.PAGE_FIELD_GRID`) had zero importers. This
 * is now the one definition; that constant re-exports this.
 */
export const FORM_GRID_PAGE =
  "grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4";

/**
 * The field grid for a form inside a dialog or sheet.
 *
 * Caps at two columns: four columns in a 600px popup is unreadable.
 */
export const FORM_GRID_DIALOG = "grid grid-cols-1 gap-x-4 gap-y-4 md:grid-cols-2";

export type FormGridVariant = "page" | "dialog";

/**
 * The one section-header style, shared by `FormSection`, the custom-fields
 * renderer and every hand-built section, so a form never mixes three looks.
 *
 * It lives in this module — a leaf with no `"use client"` and no data imports
 * — because both of its consumers need it. It was previously declared inside
 * the custom-fields renderer, which imports the Supabase browser client;
 * importing it from there would have pulled Supabase into every form section.
 */
export const SECTION_HEADER_CLASS =
  "text-section font-semibold text-foreground border-b border-border pb-1.5";

/**
 * Column spans, expressed at the same breakpoints the page grid uses so a
 * spanning field never leaves a hole in the row.
 *
 * Use `span` for the fields that genuinely need the width — address lines,
 * terms and conditions, a long description, a product table — and leave short
 * fields at the default. Stretching a short field across the page is the other
 * half of the problem a grid is meant to solve.
 */
export const FORM_FIELD_SPANS = {
  1: "",
  2: "sm:col-span-2",
  3: "sm:col-span-2 xl:col-span-3",
  4: "sm:col-span-2 xl:col-span-3 2xl:col-span-4",
  full: "col-span-full",
} as const;

export type FormFieldSpan = keyof typeof FORM_FIELD_SPANS;

export interface FormGridProps {
  /** `page` (up to 4 columns) or `dialog` (up to 2). Defaults to `page`. */
  variant?: FormGridVariant;
  className?: string;
  children: ReactNode;
}

/**
 * Wraps a row of `FormField`s in the standard responsive field grid.
 *
 * Prefer this over writing `grid-cols-*` by hand: the app had 497 inline
 * `grid-cols-*` declarations and nine different `gap-*` values on them, which
 * is why field widths and row spacing disagreed between modules.
 */
export function FormGrid({ variant = "page", className, children }: FormGridProps) {
  return (
    <div
      data-slot="form-grid"
      className={cn(variant === "page" ? FORM_GRID_PAGE : FORM_GRID_DIALOG, className)}
    >
      {children}
    </div>
  );
}
