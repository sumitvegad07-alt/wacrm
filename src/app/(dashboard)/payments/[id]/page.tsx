'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import {
  ChevronLeft, Loader2, CheckCircle2, XCircle, Ban, User as UserIcon, Phone, Mail, MapPin, FileText
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { formatCurrency } from '@/lib/currency';
import { Timeline } from '@/components/shared/timeline';
import { PaymentStatusBadge } from '@/components/payments/payment-status-badge';
import { getSourceLabel, canTransitionTo } from '@/lib/payments/statuses';
import { PERMISSIONS } from '@/lib/auth/permissions-registry';

function supaErr(e: unknown): string {
  if (!e) return 'Unknown error';
  if (e instanceof Error) return e.message;
  const o = e as { message?: string; details?: string; hint?: string; code?: string };
  return [o.message, o.details, o.hint].filter(Boolean).join(' — ') || 'Unknown error';
}

type Tab = 'details' | 'tasks';

export default function PaymentDetailPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const supabase = createClient();
  const { defaultCurrency, hasPermission } = useAuth();
  
  const canApprove = hasPermission(PERMISSIONS.PAYMENTS.APPROVE);
  const canReject = hasPermission(PERMISSIONS.PAYMENTS.REJECT);
  const canCancel = hasPermission(PERMISSIONS.PAYMENTS.CANCEL);
  const canViewAttachments = hasPermission(PERMISSIONS.PAYMENTS.VIEW_ATTACHMENTS);

  const [payment, setPayment] = useState<Record<string, any> | null>(null);
  const [customValues, setCustomValues] = useState<{ label: string; value: string }[]>([]);
  const [activities, setActivities] = useState<Record<string, any>[]>([]);
  const [tasks, setTasks] = useState<Record<string, any>[]>([]);
  const [createdBy, setCreatedBy] = useState('Unknown');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('details');
  
  const [statusSaving, setStatusSaving] = useState(false);
  
  // Dialogs state
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  
  const [attachments, setAttachments] = useState<Record<string, any>[]>([]);
  const [cancelledByName, setCancelledByName] = useState<string>('');
  const [verifiedAmount, setVerifiedAmount] = useState<string>('');
  const [rejectionReason, setRejectionReason] = useState<string>('');
  const [cancellationReason, setCancellationReason] = useState<string>('');

  const fetchPayment = useCallback(async () => {
    setLoading(true);
    const { data: p, error } = await supabase
      .from('payments')
      .select('*, contacts(*), payment_types(name)')
      .eq('id', id)
      .maybeSingle();
      
    if (error || !p) { toast.error('Payment not found'); router.push('/payments'); return; }
    setPayment(p);

    const [
      { data: cvData },
      { data: activityData },
      { data: taskData },
      ownerRes,
      { data: attachData }
    ] = await Promise.all([
      supabase.from('payment_custom_values').select('value, custom_fields(field_name)').eq('payment_id', id),
      supabase.from('module_activities').select('*').eq('module_name', 'payment').eq('record_id', id).order('created_at', { ascending: false }),
      supabase.from('tasks').select('*').eq('payment_id', id).order('created_at', { ascending: false }),
      p.user_id
        ? supabase.from('profiles').select('full_name, email').eq('user_id', p.user_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from('payment_attachments').select('*').eq('payment_id', id).order('created_at', { ascending: true }),
    ]);

    // The bucket is private, so each stored object path is exchanged for a short-lived
    // signed URL. Links expire in an hour rather than living forever in browser history.
    const rawAttachments = (attachData || []) as Record<string, any>[];
    if (rawAttachments.length > 0) {
      const signed = await Promise.all(
        rawAttachments.map(async (a) => {
          const { data: s } = await supabase.storage
            .from('payment_attachments')
            .createSignedUrl(a.file_url, 60 * 60);
          return { ...a, signed_url: s?.signedUrl ?? null };
        })
      );
      setAttachments(signed);
    } else {
      setAttachments([]);
    }

    setCustomValues((cvData || []).map((c: Record<string, any>) => ({ label: c.custom_fields?.field_name || 'Field', value: c.value })).filter((c) => c.value));
    setTasks((taskData || []) as Record<string, any>[]);

    const acts = (activityData || []) as Record<string, any>[];
    const userIds = Array.from(new Set(acts.map((a) => a.user_id).filter(Boolean)));
    if (userIds.length > 0) {
      const { data: profs } = await supabase.from('profiles').select('user_id, full_name, email').in('user_id', userIds);
      const pmap = (profs || []).reduce((m: Record<string, any>, prof: any) => { m[prof.user_id] = prof; return m; }, {});
      setActivities(acts.map((a) => ({ ...a, user: pmap[a.user_id] || null })));
    } else {
      setActivities(acts);
    }
    
    const owner = ownerRes?.data as { full_name?: string; email?: string } | null;
    setCreatedBy(owner?.full_name || owner?.email || 'Unknown');

    if (p.cancelled_by) {
      const { data: canceller } = await supabase
        .from('profiles').select('full_name, email').eq('user_id', p.cancelled_by).maybeSingle();
      setCancelledByName(canceller?.full_name || canceller?.email || 'Unknown');
    } else {
      setCancelledByName('');
    }
    setLoading(false);
  }, [id, supabase, router]);

  useEffect(() => { fetchPayment(); }, [fetchPayment]);

  async function updateStatus(newStatus: string, params: { verified_amount?: number; rejection_reason?: string; cancellation_reason?: string } = {}) {
    if (!payment) return;
    setStatusSaving(true);
    
    // Using update_payment_status RPC
    const { error } = await supabase.rpc('update_payment_status', { 
      p_payment_id: id, 
      p_new_status: newStatus,
      p_verified_amount: params.verified_amount,
      p_rejection_reason: params.rejection_reason,
      p_cancellation_reason: params.cancellation_reason
    });
    
    setStatusSaving(false);
    
    if (error) { 
      toast.error(supaErr(error)); 
      return; 
    }
    
    // Log activity
    let message = `Payment status changed to ${newStatus}.`;
    if (params.rejection_reason) message += ` Reason: ${params.rejection_reason}`;
    if (params.cancellation_reason) message += ` Reason: ${params.cancellation_reason}`;
    
    await supabase.from('module_activities').insert([{
      module_name: 'payment',
      record_id: id,
      action: 'status_changed',
      message
    }]);
    
    toast.success(`Payment ${newStatus.toLowerCase()} successfully`);
    setApproveOpen(false);
    setRejectOpen(false);
    setCancelOpen(false);
    fetchPayment();
  }

  const handleApprove = () => {
    const vAmt = verifiedAmount ? parseFloat(verifiedAmount) : payment?.amount;
    updateStatus('Approved', { verified_amount: vAmt });
  };

  const handleReject = () => {
    if (!rejectionReason.trim()) {
      toast.error('Rejection reason is required');
      return;
    }
    updateStatus('Rejected', { rejection_reason: rejectionReason });
  };

  function handleCancel() {
    if (!cancellationReason) { toast.error('Cancellation reason is required'); return; }
    updateStatus('Cancelled', { cancellation_reason: cancellationReason });
  };

  if (loading || !payment) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }

  const cust = payment.contacts || {};
  const customerName = cust.company || cust.name || 'Unknown';
  const custPhone = cust.phone || cust.whatsapp || '';
  const custEmail = cust.email || '';
  const hasLocation = payment.latitude && payment.longitude;

  const TabBtn = ({ value, label }: { value: Tab; label: string }) => (
    <button
      onClick={() => setTab(value)}
      className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${
        tab === value
          ? 'text-primary border-b-2 border-primary bg-primary/5'
          : 'text-muted-foreground border-b-2 border-transparent hover:text-foreground hover:bg-muted/40'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-6 w-full max-w-none">
      <div className="bg-card border border-border rounded-lg shadow-sm">
        <div className="flex items-start justify-between gap-4 p-5">
          <div className="flex items-start gap-3">
            <Button variant="ghost" size="icon" onClick={() => router.push('/payments')} className="text-muted-foreground hover:text-foreground shrink-0"><ChevronLeft className="size-5" /></Button>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-xl font-bold text-foreground">{customerName}</h1>
                <PaymentStatusBadge status={payment.status} />
              </div>
              <div className="text-sm text-muted-foreground mt-1.5 flex items-center gap-4 flex-wrap">
                {custPhone && <span className="flex items-center gap-1.5"><Phone className="size-3 text-primary/70" /> {custPhone}</span>}
                {custEmail && <span className="flex items-center gap-1.5"><Mail className="size-3 text-primary/70" /> {custEmail}</span>}
              </div>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-2xl font-bold tracking-wide text-primary">{payment.payment_number}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 border-t border-border px-5 py-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Amount</p>
            <p className="font-semibold text-lg">{formatCurrency(payment.amount, defaultCurrency)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Verified Amount</p>
            <p className="font-semibold text-lg text-emerald-600">
              {payment.verified_amount != null ? formatCurrency(payment.verified_amount, defaultCurrency) : '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Date</p>
            <p className="font-medium">{new Date(payment.payment_date).toLocaleDateString('en-IN')}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Collected By</p>
            <p className="font-medium flex items-center gap-1.5"><UserIcon className="size-3.5 text-muted-foreground" /> {createdBy}</p>
          </div>
        </div>

        {/* Pending payments can be ruled on. An Approved payment is otherwise immutable,
            but must stay cancellable — a cheque bounces, or the wrong customer was
            credited, and finance needs a way to reverse it that leaves a trail. */}
        {(payment.status === 'Pending' || payment.status === 'Approved') && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3 bg-muted/20">
            {payment.status === 'Pending' && canApprove && (
              <Button onClick={() => { setVerifiedAmount(payment.amount.toString()); setApproveOpen(true); }} className="gap-1.5" size="sm">
                <CheckCircle2 className="size-4" /> Approve
              </Button>
            )}
            {payment.status === 'Pending' && canReject && (
              <Button onClick={() => setRejectOpen(true)} variant="destructive" className="gap-1.5" size="sm">
                <XCircle className="size-4" /> Reject
              </Button>
            )}
            {canCancel && (
              <Button onClick={() => setCancelOpen(true)} variant="outline" className="gap-1.5" size="sm">
                <Ban className="size-4" /> Cancel
              </Button>
            )}
            {payment.status === 'Approved' && canCancel && (
              <span className="text-xs text-muted-foreground ml-1">
                Cancelling restores this amount to the customer&apos;s outstanding balance.
              </span>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2">
          <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
            <div className="flex border-b border-border">
              <TabBtn value="details" label="Details" />
              <TabBtn value="tasks" label={`Tasks${tasks.length ? ` (${tasks.length})` : ''}`} />
            </div>

            {tab === 'details' && (
              <div className="p-5 space-y-6">
                <div>
                  <h3 className="text-lg font-semibold mb-4">Payment Details</h3>
                  <div className="grid grid-cols-2 gap-y-4 gap-x-6 text-sm">
                    <div>
                      <p className="text-muted-foreground mb-1">Payment Type</p>
                      <p className="font-medium">{payment.payment_types?.name || 'Unknown'}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground mb-1">Source</p>
                      <p className="font-medium">{getSourceLabel(payment.source)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground mb-1">Reference Number</p>
                      <p className="font-medium">{payment.reference_number || '—'}</p>
                    </div>
                    {payment.rejection_reason && (
                      <div className="col-span-2">
                        <p className="text-muted-foreground mb-1 text-red-600">Rejection Reason</p>
                        <p className="font-medium text-red-600 bg-red-50 p-3 rounded-md">{payment.rejection_reason}</p>
                      </div>
                    )}
                    {payment.status === 'Cancelled' && (
                      <div className="col-span-2">
                        <p className="text-muted-foreground mb-1">Cancellation</p>
                        <div className="bg-muted/50 border border-border p-3 rounded-md space-y-1">
                          <p className="font-medium">{payment.cancellation_reason || 'No reason recorded'}</p>
                          <p className="text-xs text-muted-foreground">
                            {cancelledByName ? `Cancelled by ${cancelledByName}` : 'Cancelled'}
                            {payment.cancelled_at ? ` on ${new Date(payment.cancelled_at).toLocaleString('en-IN')}` : ''}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {customValues.length > 0 && (
                  <div className="border-t border-border pt-5">
                    <h3 className="text-lg font-semibold mb-4">Additional Details</h3>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      {customValues.map((cv, i) => (
                        <div key={i}>
                          <p className="text-muted-foreground mb-1">{cv.label}</p>
                          <p className="font-medium">{cv.value}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {payment.notes && (
                  <div className="border-t border-border pt-5">
                    <h3 className="text-lg font-semibold mb-2">Notes</h3>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{payment.notes}</p>
                  </div>
                )}
                
                {hasLocation && (
                  <div className="border-t border-border pt-5">
                    <h3 className="text-lg font-semibold mb-2 flex items-center gap-2"><MapPin className="size-4" /> Location</h3>
                    <div className="h-48 bg-muted rounded-md flex items-center justify-center overflow-hidden border">
                       {/* This would be an actual map component in a full implementation */}
                       <a 
                          href={`https://www.google.com/maps/search/?api=1&query=${payment.latitude},${payment.longitude}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline flex items-center gap-2"
                       >
                         View on Google Maps ({payment.latitude}, {payment.longitude})
                       </a>
                    </div>
                  </div>
                )}
                
                {attachments.length > 0 && canViewAttachments && (
                  <div className="border-t border-border pt-5">
                    <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                      <FileText className="size-4" /> Attachments
                    </h3>
                    <div className="mt-2 space-y-2">
                      {attachments.map((a) => (
                        <div key={a.id} className="flex items-center gap-2 text-sm">
                          {a.signed_url ? (
                            <a
                              href={a.signed_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary hover:underline"
                            >
                              {a.file_name}
                            </a>
                          ) : (
                            <span className="text-muted-foreground">{a.file_name} (unavailable)</span>
                          )}
                          {a.file_size ? (
                            <span className="text-muted-foreground text-xs">
                              {(a.file_size / 1024).toFixed(0)} KB
                            </span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            
            {tab === 'tasks' && (
              <div className="p-5">
                <p className="text-sm text-muted-foreground">Tasks associated with this payment.</p>
                {/* Tasks list would be rendered here */}
              </div>
            )}
          </div>
        </div>

        <div className="w-full">
          <Timeline moduleName="payment" recordId={id} tasks={tasks} activities={activities} onRefresh={fetchPayment} />
        </div>
      </div>
      
      {/* Approval Dialog */}
      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Verified Amount (Optional)</Label>
              <Input 
                type="number" 
                step="0.01" 
                value={verifiedAmount} 
                onChange={(e) => setVerifiedAmount(e.target.value)} 
                placeholder={payment.amount.toString()}
              />
              <p className="text-xs text-muted-foreground">Leave blank to use the original amount.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveOpen(false)}>Cancel</Button>
            <Button onClick={handleApprove} disabled={statusSaving}>
              {statusSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm Approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Reject Dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Reason <span className="text-red-500">*</span></Label>
              <Textarea 
                value={rejectionReason} 
                onChange={(e) => setRejectionReason(e.target.value)} 
                placeholder="Please provide a reason for rejection"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleReject} disabled={statusSaving || !rejectionReason.trim()}>
              {statusSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Reject Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Cancel Dialog */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              {payment.status === 'Approved'
                ? `This payment is already approved. Cancelling it adds ${formatCurrency(payment.verified_amount ?? payment.amount, defaultCurrency)} back to the customer's outstanding balance. The record is kept, not deleted.`
                : 'Cancelling keeps the record for audit; it is never deleted. This cannot be undone.'}
            </p>
            <div className="space-y-2">
              <Label>Cancellation Reason <span className="text-red-500">*</span></Label>
              <Select value={cancellationReason} onValueChange={(val) => setCancellationReason(val || '')}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a reason" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Wrong Customer">Wrong Customer</SelectItem>
                  <SelectItem value="Wrong Amount">Wrong Amount</SelectItem>
                  <SelectItem value="Duplicate Entry">Duplicate Entry</SelectItem>
                  <SelectItem value="Cheque Bounced">Cheque Bounced</SelectItem>
                  <SelectItem value="Payment Returned">Payment Returned</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>Back</Button>
            <Button variant="destructive" onClick={handleCancel} disabled={statusSaving}>
              {statusSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
