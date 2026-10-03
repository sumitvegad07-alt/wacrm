import { PageLayout, TableSkeleton } from "@/components/shared";

// Shown while the server fetches the first page of assets. Same skeleton the table uses for
// in-page loading, so the two never look different.
export default function AssetsLoading() {
  return (
    <PageLayout>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <TableSkeleton columns={8} rows={8} />
      </div>
    </PageLayout>
  );
}
