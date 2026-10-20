import { INVOICE_STATUS_LABEL, type InvoiceStatus } from "@/lib/invoices/types";

// One badge, shared by the list and the detail screen, so a status can never
// read one colour in the table and another on the invoice itself.
const TONE: Record<InvoiceStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  issued: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  part_paid: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  paid: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  cancelled: "bg-red-500/10 text-red-600 dark:text-red-400",
};

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${TONE[status] ?? TONE.draft}`}
    >
      {INVOICE_STATUS_LABEL[status] ?? status}
    </span>
  );
}
