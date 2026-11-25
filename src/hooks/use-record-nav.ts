"use client";

import { useEffect, useState } from "react";

import {
  NO_NEIGHBOURS,
  neighbours,
  readRecordOrder,
  saveRecordOrder,
  type Neighbours,
} from "@/lib/record-nav/order";

export type { Neighbours } from "@/lib/record-nav/order";

/**
 * From a LIST: remember the order these rows are in.
 *
 * Lives in `DataTable`, not in the pages, for the same reason the unread
 * highlight does — one caller means the behaviour cannot drift between the
 * lists, and the table is the only thing that knows the order after sorting,
 * searching and filtering have all had their say.
 *
 * The ids are joined into one string for the dependency, so re-rendering a
 * list whose rows have not changed does not write to storage again.
 */
export function useRememberRecordOrder(module: string | undefined, ids: string[]): void {
  const fingerprint = module ? ids.join(",") : "";

  useEffect(() => {
    if (!module) return;
    saveRecordOrder(module, fingerprint ? fingerprint.split(",") : []);
  }, [module, fingerprint]);
}

/**
 * From a RECORD: what is either side of it in the list you came from.
 *
 * Read in an effect rather than during render. sessionStorage does not exist
 * on the server, so reading it while rendering gives the server one answer and
 * the browser another, and React tears the tree down over the mismatch. One
 * frame with no arrows is the correct trade.
 */
export function useRecordNav(module: string, id: string | null | undefined): Neighbours {
  const [nav, setNav] = useState<Neighbours>(NO_NEIGHBOURS);

  useEffect(() => {
    setNav(neighbours(readRecordOrder(module), id));
  }, [module, id]);

  return nav;
}
