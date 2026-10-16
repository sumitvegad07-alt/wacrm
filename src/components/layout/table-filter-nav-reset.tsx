"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { bumpTableNavSeq } from "@/lib/table-views";

/**
 * Counts screen changes so an ad-hoc table filter lasts exactly one visit.
 *
 * Renders nothing. Mounted once in the dashboard shell, above every list
 * screen, so the counter has already moved by the time the next screen's
 * `useTableView` reads its stored filters.
 *
 * Deliberately keyed on the pathname and nothing else: a query-string change
 * (paging, a tab, an id) is still the same screen and must not wipe the
 * filters the user is working with.
 */
export function TableFilterNavReset() {
  const pathname = usePathname();
  const previous = useRef<string | null>(null);

  useEffect(() => {
    // The first render is arriving somewhere, not leaving somewhere.
    if (previous.current !== null && previous.current !== pathname) {
      bumpTableNavSeq();
    }
    previous.current = pathname;
  }, [pathname]);

  return null;
}
