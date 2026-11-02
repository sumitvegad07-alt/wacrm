"use client";

/**
 * `<Link>`, wired into the app's navigation progress bar.
 *
 * Every screen in this app imports `Link` from here rather than from `next/link`, and
 * `npm run lint:ui` fails the build when one does not.
 *
 * The reason is the same as for `@/lib/navigation`'s `useRouter`: a client-side
 * navigation shows nothing at all until the next route arrives. A `<Link>` is better off
 * than a `router.push` button — Next prefetches it, and `loading.tsx` eventually paints —
 * but on a cold route against a database in Mumbai there is still a silent second or more
 * between the click and anything moving. The complaint was explicitly "any button, any
 * record, any line, any table, any row, anything at all", and a link is one of those.
 *
 * `useLinkStatus` is Next's own hook for that gap and can only be called from inside a
 * `<Link>`, hence the inner component.
 *
 * Nothing else changes: every prop, including `prefetch`, `replace`, `scroll` and
 * `onNavigate`, passes straight through, so a file converts by changing one import line.
 */

import * as React from "react";
import NextLink from "next/link";
import { useLinkStatus } from "next/link";

import { startNavigationProgress } from "@/components/layout/navigation-progress";

type NextLinkProps = React.ComponentProps<typeof NextLink>;

/**
 * Reports this link's own pending state to the bar. A child rather than a flag, because
 * `useLinkStatus` reads a context that only exists inside the `<Link>` it belongs to.
 */
function LinkProgress() {
  const { pending } = useLinkStatus();

  React.useEffect(() => {
    if (pending) startNavigationProgress();
  }, [pending]);

  return null;
}

export function Link({ children, ...props }: NextLinkProps) {
  return (
    <NextLink {...props}>
      {children}
      <LinkProgress />
    </NextLink>
  );
}

export default Link;
