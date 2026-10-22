import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * The shared layout vocabulary for every settings panel.
 *
 * Each panel used to invent its own: a survey of the twenty-five of them found
 * seven different card shells (`rounded-lg`/`rounded-xl`/`rounded-md`, padding
 * from p-3 to p-6, four different backgrounds) and fourteen different heading
 * treatments for the same rank of thing — including one in `text-gray-600`,
 * a raw Tailwind grey that ignores the theme and reads as muddy in dark mode.
 * Two adjacent tabs could look like two different products: Organization
 * Settings stacked full-width cards with the control UNDER its label, while
 * Catalogue Settings ran a two-column grid of borderless sections.
 *
 * So these are deliberately few and deliberately rigid. A panel composes
 * them; it does not restyle them.
 *
 *   <SettingsPanel title description actions>
 *     <SettingsCard title description>
 *       <SettingsRow label description control={<Switch/>} />
 *       <SettingsRow label description control={<Select/>} />
 *     </SettingsCard>
 *   </SettingsPanel>
 *
 * The alignment the rows give you is the point: every control sits in a
 * fixed-width right-hand column, so a column of toggles and selects lines up
 * down the panel however long or short the labels beside them are.
 */

const CONTROL_COLUMN = 'sm:w-64';

export function SettingsPanel({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('w-full space-y-4 pb-10', className)}>
      {(title || description || actions) && (
        <header className="flex flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {title && (
              <h2 className="text-base font-semibold text-foreground">{title}</h2>
            )}
            {description && (
              <p className="mt-0.5 max-w-prose text-xs text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          {actions && (
            <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
          )}
        </header>
      )}
      {children}
    </section>
  );
}

/**
 * One titled block inside a panel. The heading sits on its own bar so a card's
 * title, its description and any per-card action always line up with every
 * other card's, whatever the panel.
 */
export function SettingsCard({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cn('rounded-xl border border-border bg-card', className)}
    >
      {(title || action) && (
        <header className="flex flex-col gap-2 border-b border-border/70 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            {title && (
              <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            )}
            {description && (
              <p className="mt-0.5 max-w-prose text-xs text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          {action && (
            <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>
          )}
        </header>
      )}
      <div className={cn('px-4 py-1.5', bodyClassName)}>{children}</div>
    </section>
  );
}

/**
 * A labelled setting: text on the left, its control in the fixed right-hand
 * column. `children` renders under both, for the extra configuration a setting
 * reveals when it is switched on.
 */
export function SettingsRow({
  label,
  description,
  control,
  htmlFor,
  children,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  control?: ReactNode;
  htmlFor?: string;
  children?: ReactNode;
  className?: string;
}) {
  const Label = htmlFor ? 'label' : 'div';
  return (
    <div
      className={cn(
        'border-b border-border/60 py-2.5 last:border-0',
        className,
      )}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <Label
          {...(htmlFor ? { htmlFor } : {})}
          className={cn('min-w-0 flex-1', htmlFor && 'cursor-pointer')}
        >
          <span className="block text-sm font-medium text-foreground">{label}</span>
          {description && (
            <span className="mt-0.5 block max-w-prose text-xs text-muted-foreground">
              {description}
            </span>
          )}
        </Label>
        {control && (
          <div
            className={cn(
              'flex shrink-0 items-center gap-2 sm:justify-end',
              CONTROL_COLUMN,
            )}
          >
            {control}
          </div>
        )}
      </div>
      {children && <div className="mt-2.5">{children}</div>}
    </div>
  );
}

/**
 * A form control with its label above it, for the panels that are a form
 * rather than a list of settings. Use inside `SettingsFieldGrid`.
 */
export function SettingsField({
  label,
  hint,
  htmlFor,
  required,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <label
        htmlFor={htmlFor}
        className="block text-xs font-medium text-foreground"
      >
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** The standard field grid: one column on a phone, two from `sm` up. */
export function SettingsFieldGrid({
  children,
  columns = 2,
  className,
}: {
  children: ReactNode;
  columns?: 1 | 2 | 3;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid gap-x-4 gap-y-3',
        columns === 1 && 'grid-cols-1',
        columns === 2 && 'grid-cols-1 sm:grid-cols-2',
        columns === 3 && 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * The row of buttons that closes a panel or a card. Right-aligned on desktop,
 * full-width stacked on a phone, always in the same place.
 */
export function SettingsActions({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col-reverse gap-2 border-t border-border pt-3 sm:flex-row sm:justify-end',
        className,
      )}
    >
      {children}
    </div>
  );
}
