import Link from "next/link";

import type { CustomerSource, DetailGroup } from "@/lib/service/assets/detail-view";

export interface AssetDetailsProps {
  /** From buildDetailGroups: every field, already formatted, grouped as the form groups them. */
  groups: DetailGroup[];
  customer: {
    source: CustomerSource;
    /** Only set when the live contact is readable. */
    contactId: string | null;
  };
  /** creationSnapshotNote: what the customer was called at creation, ONLY when that differs from now. */
  snapshotNote: string | null;
}

const EMPTY = <span className="text-muted-foreground">—</span>;

/** The Details tab: every field read-only. A Server Component, no client code. */
export function AssetDetails({ groups, customer, snapshotNote }: AssetDetailsProps) {
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <section key={group.title} aria-labelledby={`asset-group-${group.title}`} className="rounded-xl border border-border bg-card p-5">
          <h2 id={`asset-group-${group.title}`} className="mb-4 text-sm font-semibold text-foreground">
            {group.title}
          </h2>
          <dl className={group.title === "Notes" ? "grid grid-cols-1 gap-4" : "grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3"}>
            {group.fields.map((field) => (
              <div key={field.key} className="min-w-0 space-y-1">
                <dt className="text-xs text-muted-foreground">{field.label}</dt>
                <dd className="break-words text-sm text-foreground">
                  {field.value === null ? (
                    EMPTY
                  ) : field.key === "asset_code" ? (
                    <span className="font-mono">{field.value}</span>
                  ) : field.key === "customer" ? (
                    <div className="space-y-1">
                      {customer.contactId && customer.source === "live" ? (
                        <Link href={`/contacts/${customer.contactId}`} className="hover:text-primary hover:underline">
                          {field.value}
                        </Link>
                      ) : (
                        <span>{field.value}</span>
                      )}
                      {customer.source === "snapshot" && (
                        <p className="text-xs text-muted-foreground">
                          The customer&rsquo;s current record is not visible to you. This is the name recorded when the
                          asset was created.
                        </p>
                      )}
                      {snapshotNote && (
                        <p className="text-xs text-muted-foreground">
                          Recorded at creation: <span className="text-foreground">{snapshotNote}</span>
                        </p>
                      )}
                    </div>
                  ) : field.key === "notes" ? (
                    <span className="whitespace-pre-wrap">{field.value}</span>
                  ) : (
                    field.value
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
