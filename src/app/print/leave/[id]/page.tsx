import { createClient } from '@/lib/supabase/server';
import { fetchLetterhead } from '@/lib/document-templates/company-profile';
import { InternalVoucher, type VoucherRow } from '@/components/print/internal-voucher';
import { parsePaperSize } from '@/lib/print/paper';

/**
 * Print / PDF view for a single leave record.
 *
 * Server component, scoped by RLS exactly like the expense voucher beside it.
 */
export default async function LeavePrintView(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ size?: string }>;
}) {
  const { id } = await props.params;
  const paper = parsePaperSize((await props.searchParams)?.size);
  const supabase = await createClient();

  const { data: leave } = await supabase
    .from('leaves')
    .select('*, leave_types(name), employee:profiles!leaves_employee_id_fkey(full_name, email, employee_code)')
    .eq('id', id)
    .maybeSingle();

  if (!leave) {
    return <div className="p-8 text-center text-red-500 bg-white min-h-screen">Leave not found</div>;
  }

  const letterhead = await fetchLetterhead(supabase, leave.account_id);

  // approved_by / rejected_by are auth user ids, not profiles.id.
  const decidedBy = leave.approved_by || leave.rejected_by;
  const { data: decider } = decidedBy
    ? await supabase.from('profiles').select('full_name, email').eq('user_id', decidedBy).maybeSingle()
    : { data: null };

  const date = (v: string | null | undefined) =>
    v
      ? new Date(v)
          .toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })
          .replace(/\//g, '-')
      : '';

  const rows: VoucherRow[] = [
    { label: 'Leave type', value: leave.leave_types?.name || '' },
    // total_days is stored when the request is raised, against the account's
    // own working week. Never recomputed here: the working week is
    // configurable, and assuming Monday to Friday was a real bug once.
    { label: 'Total days', value: String(leave.total_days ?? '') },
    { label: 'From', value: date(leave.from_date) },
    { label: 'To', value: date(leave.to_date) },
    { label: 'Reason', value: leave.reason || '', wide: true },
  ];

  if (leave.is_backdated) {
    rows.push({ label: 'Applied', value: 'Backdated request' });
  }
  if (decider) {
    rows.push({
      label: leave.approved_by ? 'Approved by' : 'Rejected by',
      value: decider.full_name || decider.email || '',
    });
    rows.push({
      label: leave.approved_by ? 'Approved on' : 'Rejected on',
      value: date(leave.approved_at || leave.rejected_at),
    });
  }
  if (leave.rejection_reason) {
    rows.push({ label: 'Rejection reason', value: leave.rejection_reason, wide: true });
  }

  return (
    <InternalVoucher
      paper={paper}
      letterhead={letterhead}
      title="Leave Record"
      number={leave.leave_number || `LV-${String(leave.id).substring(0, 8).toUpperCase()}`}
      employeeName={leave.employee?.full_name || leave.employee?.email || 'Unknown'}
      employeeCode={leave.employee?.employee_code || undefined}
      rows={rows}
      status={leave.status || ''}
      footNote={leave.attachment_name ? `Attachment on file: ${leave.attachment_name}` : undefined}
    />
  );
}
