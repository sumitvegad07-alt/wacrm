import { cn } from "@/lib/utils"

/**
 * The one shape every form control shares.
 *
 * Before this file there were five desktop control heights (32 / 36 / 36 / 40 /
 * 40px), two corner radii (`rounded-lg` and `rounded-md`), three focus rings
 * (`ring-3 ring-ring/50`, `ring-2` + offset, `ring-1 ring-primary`) and two
 * surfaces (transparent and a filled `bg-muted`) across Button, Input, Select,
 * SearchableSelect, AsyncSearchSelect, MultiSelect, CollaboratorsSelect and
 * CustomFieldInput. They arrived in two eras — the Base UI rewrite and the
 * older shadcn-v1 components, which were never migrated — so a text field and
 * the searchable dropdown next to it in the same form row disagreed on all
 * four. Every module's create/edit form shows that row.
 *
 * Composing from here instead of copying a class string is the point: a control
 * that imports these cannot drift, and one that does not is visible in a grep.
 */

/**
 * Border, background, radius, focus ring, disabled and invalid states.
 *
 * No height, no padding, no layout — so it also fits a control that sizes
 * itself (Textarea, MultiSelect with wrapping chips).
 *
 * Deliberately transparent rather than filled: the shared Input has always
 * been transparent over the card, and `CustomFieldInput` forcing `bg-muted`
 * was why a tenant's custom fields looked unlike the predefined fields in the
 * same section of the same form.
 */
export const controlSurfaceClassName =
  "rounded-lg border border-input bg-transparent transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"

/**
 * 44px for a thumb below md, the 32px desktop density above it.
 *
 * Both halves matter. 32px is what the density pass set so a 1366x768 laptop
 * fits a useful number of grid rows; 44px is the Apple/Google touch target,
 * and the compact size was genuinely unhittable with a thumb.
 */
export const controlHeightClassName = "h-control-touch md:h-control"

/**
 * 16px below md, 14px above.
 *
 * The 16px is not cosmetic: iOS Safari zooms the page when a field with text
 * smaller than 16px takes focus.
 */
export const controlTextClassName = "text-base md:text-body"

/**
 * A full-width button that opens a panel — the popover and dropdown triggers
 * that have to line up with an `<Input>` beside them in a form grid.
 *
 * Horizontal padding is written WITHOUT a responsive variant on purpose:
 * tailwind-merge keeps a base class whose variant differs from the caller's,
 * and Tailwind emits media queries last, so a responsive base padding can
 * never be overridden by a caller's plain `pl-*`. See ui/input-padding.test.ts
 * — that is a bug this codebase has already shipped once.
 */
export const controlTriggerClassName = cn(
  controlSurfaceClassName,
  controlHeightClassName,
  controlTextClassName,
  "flex w-full items-center justify-between gap-1.5 px-3 text-left font-normal whitespace-nowrap select-none"
)

/**
 * Width for a popover panel anchored to a control, so the panel lines up with
 * its trigger.
 *
 * `--anchor-width` is Base UI's. The three select components here were written
 * against Radix and still asked for `--radix-popover-trigger-width`, which does
 * not exist on a Base UI positioner — so the rule was dropped and every panel
 * silently fell back to the base `w-72`, matching no trigger at all.
 */
export const controlPanelWidthClassName = "w-(--anchor-width) min-w-(--anchor-width)"
