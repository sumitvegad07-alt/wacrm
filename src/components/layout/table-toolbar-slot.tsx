"use client";

import * as React from "react";

/**
 * The slot that lets a DataTable put its controls in the page's heading row.
 *
 * The table's toolbar used to be a strip of its own above the grid. It cost a
 * line of vertical space on all 26 data screens to hold four controls, and
 * once every column grew its own filter the strip stopped earning it. Rather
 * than rewire 29 page files to pass the controls up by hand — slow, and two
 * components that can drift apart — the table renders them straight into the
 * header through a portal.
 *
 * `claimed` exists because PageHeader returns null when it has nothing of its
 * own to show. On such a page the portal would have nowhere to go and the
 * controls would vanish silently. Claiming forces the header to render.
 */
interface TableToolbarSlot {
  node: HTMLElement | null;
  setNode: (el: HTMLElement | null) => void;
  claimed: boolean;
  claim: () => void;
  release: () => void;
}

const Ctx = React.createContext<TableToolbarSlot | null>(null);

export function TableToolbarSlotProvider({ children }: { children: React.ReactNode }) {
  // State, not a ref: the table must re-render once the node exists, and the
  // header must re-render once the slot is claimed.
  const [node, setNode] = React.useState<HTMLElement | null>(null);
  const [claims, setClaims] = React.useState(0);

  const claim = React.useCallback(() => setClaims((n) => n + 1), []);
  const release = React.useCallback(() => setClaims((n) => Math.max(0, n - 1)), []);

  const value = React.useMemo(
    () => ({ node, setNode, claimed: claims > 0, claim, release }),
    [node, claims, claim, release],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Null-safe on purpose. A table rendered outside the dashboard shell — a
 * print route, a test — gets an inert slot and falls back to its own inline
 * toolbar rather than throwing.
 */
export function useTableToolbarSlot(): TableToolbarSlot {
  const ctx = React.useContext(Ctx);
  const noop = React.useCallback(() => {}, []);
  const inert = React.useMemo(
    () => ({ node: null, setNode: noop, claimed: false, claim: noop, release: noop }),
    [noop],
  );
  return ctx ?? inert;
}

/** Whether PageHeader renders at all. See the `claimed` note above. */
export function shouldRenderHeader(args: {
  breadcrumbs: boolean;
  badge: boolean;
  actions: boolean;
  claimed: boolean;
}): boolean {
  return args.breadcrumbs || args.badge || args.actions || args.claimed;
}
