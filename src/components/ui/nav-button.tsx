"use client";

/**
 * A button whose job is to open another page, instrumented so it never reads as dead.
 *
 * The app had 73 controls written as `<Button onClick={() => router.push(href)}>`. Two
 * things are wrong with that shape, and both of them are why Add Customer, Add Lead,
 * Add Employee and every Edit button felt broken:
 *
 *   * **Nothing is prefetched.** Next only warms a route that something points at — a
 *     `<Link>`, or an explicit `router.prefetch`. A button that pushes in an onClick
 *     points at nothing, so the whole payload and JS chunk are fetched only AFTER the
 *     click. The sidebar and the table rows were fixed by warming the route on hover;
 *     these never were.
 *
 *   * **The control says nothing.** React keeps the page you are leaving fully
 *     interactive until the next route arrives, so the button looks exactly as it did
 *     before you pressed it.
 *
 * `NavButton` takes the destination as `href` instead of an onClick and handles both:
 * it warms the route when the pointer rests on it, and it goes to a spinner the instant
 * it is pressed and stays there until the page changes. The top-of-app progress bar
 * (components/layout/navigation-progress.tsx) covers the same navigation at the page
 * level; this covers it at the control the user is actually looking at.
 *
 * Role gating is built in rather than bolted on, because most of these buttons are
 * gated: pass `canAct` / `gateReason` exactly as for `GatedButton`.
 */

import * as React from "react";
import { Loader2 } from "lucide-react";

import { useRouter } from "@/lib/navigation";
import { GatedButton } from "@/components/ui/gated-button";
import { cn } from "@/lib/utils";

type GatedButtonProps = React.ComponentProps<typeof GatedButton>;

interface NavButtonProps extends Omit<GatedButtonProps, "onClick" | "href"> {
  /** Where this button goes. */
  href: string;
  /** Warm the route on hover. On by default; turn it off for a rarely-pressed button. */
  prefetchOnHover?: boolean;
}

/** Long enough that running the pointer across a toolbar does not warm every route. */
const HOVER_DWELL_MS = 120;

export function NavButton({
  href,
  prefetchOnHover = true,
  children,
  className,
  disabled,
  size,
  ...rest
}: NavButtonProps) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const warmed = React.useRef(false);
  const dwell = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // The destination changing makes any previous warm-up irrelevant, and a button that
  // was left pending by a navigation that went nowhere has to come back.
  React.useEffect(() => {
    warmed.current = false;
    setPending(false);
  }, [href]);

  React.useEffect(() => () => {
    if (dwell.current) clearTimeout(dwell.current);
  }, []);

  const warm = () => {
    if (!prefetchOnHover || warmed.current || disabled) return;
    if (dwell.current) clearTimeout(dwell.current);
    dwell.current = setTimeout(() => {
      dwell.current = null;
      if (warmed.current) return;
      warmed.current = true;
      try {
        router.prefetch(href);
      } catch {
        // A prefetch is an optimisation; the click still works without it.
      }
    }, HOVER_DWELL_MS);
  };

  const cancelWarm = () => {
    if (dwell.current) {
      clearTimeout(dwell.current);
      dwell.current = null;
    }
  };

  return (
    <GatedButton
      {...rest}
      size={size}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={cn(pending && "cursor-progress", className)}
      onPointerEnter={warm}
      onPointerLeave={cancelWarm}
      onFocus={warm}
      onClick={() => {
        setPending(true);
        router.push(href);
      }}
    >
      {/* An icon-only button has no room beside its icon, so the spinner replaces it
          rather than being squeezed in next to it. */}
      {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
      {pending && size === "icon" ? null : children}
    </GatedButton>
  );
}
