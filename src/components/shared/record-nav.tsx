"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { useRouter } from "@/lib/navigation";
import { useRecordNav } from "@/hooks/use-record-nav";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * ‹ › — step to the record before or after this one, without going back to
 * the list.
 *
 * Working a list means opening a record, reading it, going back, finding your
 * place again, and opening the next one. The going back and the finding your
 * place are the whole cost, and they are paid once per record. Two arrows
 * remove both.
 *
 * ── Deliberately symbolic ──
 *
 * Asked for as a symbol and not a word, which is also the right answer: this
 * sits in a header beside Edit, Convert and Print, and a "Next" sized like
 * those reads as another action rather than as a way of moving. Both buttons
 * carry an `aria-label` and a `title`, so a screen reader and a hover both get
 * the word anyway.
 *
 * ── Which records, in which order ──
 *
 * Whatever the list was showing — see `lib/record-nav/order.ts`. A record
 * opened from somewhere other than its list has no neighbours, and the
 * arrows are not rendered at all. They are an aid; an empty pair of dead
 * controls would be worse than nothing.
 */
export function RecordNav({
  module,
  currentId,
  hrefOf,
  noun,
  className,
}: {
  /** The list's module key — the same string its table passes as `navModule`. */
  module: string;
  currentId: string;
  /** Where a neighbouring record lives. */
  hrefOf: (id: string) => string;
  /** What one record is called, for the hover text: "lead", "customer". */
  noun: string;
  className?: string;
}) {
  const router = useRouter();
  const { prevId, nextId, position, total } = useRecordNav(module, currentId);

  /**
   * Warm both neighbours while this record is being read. The click then
   * costs a render rather than a round trip to Mumbai — the same reason the
   * table prefetches a row on hover.
   */
  React.useEffect(() => {
    if (prevId) router.prefetch(hrefOf(prevId));
    if (nextId) router.prefetch(hrefOf(nextId));
    // `hrefOf` is a literal arrow function at every call site, so it would be a
    // new identity on every render; the ids are what actually decides this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prevId, nextId, router]);

  if (!prevId && !nextId) return null;

  return (
    <div
      className={cn("flex shrink-0 items-center gap-1", className)}
      role="group"
      aria-label={`Move between ${noun}s`}
    >
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        disabled={!prevId}
        onClick={() => prevId && router.push(hrefOf(prevId))}
        aria-label={`Previous ${noun}`}
        title={`Previous ${noun}`}
      >
        <ChevronLeft className="size-4" />
      </Button>

      {/* Not a label on the buttons — a position. Without it the arrows say
          nothing about how far through the list you are, which is the first
          thing anyone working down one wants to know. */}
      {position > 0 && total > 0 ? (
        <span className="px-1 text-caption tabular-nums text-muted-foreground">
          {position} / {total}
        </span>
      ) : null}

      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        disabled={!nextId}
        onClick={() => nextId && router.push(hrefOf(nextId))}
        aria-label={`Next ${noun}`}
        title={`Next ${noun}`}
      >
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}
