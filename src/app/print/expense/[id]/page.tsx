import { createClient } from '@/lib/supabase/server';
import { formatCurrency } from '@/lib/currency';
import { fetchLetterhead } from '@/lib/document-templates/company-profile';
import { InternalVoucher, type VoucherRow } from '@/components/print/internal-voucher';
import { parsePaperSize } from '@/lib/print/paper';

/**
 * Print / PDF view for a single expense claim.
 *
 * Server component, like the payment receipt it sits beside. RLS does the
 * scoping: an employee reaches their own claims, an approver reaches the ones
 * they can see, and anybody else gets "not found" because the row simply does
 * not come back.
 */
export default async function ExpensePrintView(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ size?: string }>;
}) {
  const { id } = await props.params;
  const paper = parsePaperSize((await props.searchParams)?.size);
  const supabase = await createClient();

  const { data: expense } = await supabase
    .from('expenses')
    // expense_types names its label column `expense_name`, not `name`.
    .select('*, expense_type:expense_types(expense_name), employee:profiles!expenses_employee_id_fkey(full_name, email, employee_code)')
    .eq('id', id)
    .maybeSingle();

  if (!expense) {
    return <div className="p-8 text-center text-red-500 bg-white min-h-screen">Expense not found</div>;
  }

  const letterhead = await fetchLetterhead(supabase, expense.account_id);

  // The approver is an auth user id here, not a profiles.id — the two id
  // spaces differ in this database and swapping them silently returns nobody.
  const { data: approver } = expense.approved_by
    ? await supabase
        .from('profiles')
        .select('full_name, email')
        .eq('user_id', expense.approved_by)
        .maybeSingle()
    : { data: null };

  const date = (v: string | null | undefined) =>
    v
      ? new Date(v)
          .toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })
          .replace(/\//g, '-')
      : '';

  const rows: VoucherRow[] = [
    { label: 'Expense date', value: date(expense.expense_date) },
    { label: 'Category', value: expense.expense_type?.expense_name || '' },
    { label: 'Claimed', value: formatCurrency(Number(expense.amount || 0)) },
    {
      label: 'Approved',
      value:
        expense.approved_amount != null ? formatCurrency(Number(expense.approved_amount)) : '',
    },
  ];

  // Travel claims are the ones anyone ever queries, so show the working.
  if (expense.travel_km != null) {
    rows.push({ label: 'Distance', value: `${expense.travel_km} km` });
    rows.push({
      label: 'Rate per km',
      value: expense.rate_per_km != null ? formatCurrency(Number(expense.rate_per_km)) : '',
    });
  }

  if (approver) {
    rows.push({ label: 'Approved by', value: approver.full_name || approver.email || '' });
    rows.push({ label: 'Approved on', value: date(expense.approved_at) });
  }
  if (expense.rejection_reason) {
    rows.push({ label: 'Rejection reason', value: expense.rejection_reason, wide: true });
  }
  if (expense.remarks) {
    rows.push({ label: 'Remarks', value: expense.remarks, wide: true });
  }

  // The amount actually payable is the approved one once it exists, which is
  // the same rule the expense reports settle on.
  const payable = expense.approved_amount != null ? expense.approved_amount : expense.amount;

  return (
    <InternalVoucher
      paper={paper}
      letterhead={letterhead}
      title="Expense Voucher"
      number={expense.expense_number || `EXP-${String(expense.id).substring(0, 8).toUpperCase()}`}
      employeeName={expense.employee?.full_name || expense.employee?.email || 'Unknown'}
      employeeCode={expense.employee?.employee_code || undefined}
      rows={rows}
      amount={formatCurrency(Number(payable || 0))}
      amountLabel={expense.approved_amount != null ? 'Approved amount' : 'Claimed amount'}
      status={expense.status || ''}
      // Never embedded: a phone photo runs to several megabytes and would make
      // the sheet slow to render and pointless to print.
      footNote={expense.proof_file ? 'A proof document is attached to this claim in OZZO.' : undefined}
    />
  );
}
