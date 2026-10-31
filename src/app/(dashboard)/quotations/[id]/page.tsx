'use client';

import { useEffect, useState, use } from 'react';
import { useMarkRecordSeen } from "@/hooks/use-record-views";
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { sanitizeRichText } from '@/lib/security/sanitize-html';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Edit, Copy, Check, X, FileText, Loader2, Send, FilePlus2, Pencil, ArrowUpRight } from 'lucide-react';
import { PrintSizeMenu } from '@/components/print/print-size-menu';
import Link from 'next/link';
import { QuotationTimeline } from '@/components/quotations/quotation-timeline';
import { Timeline } from '@/components/shared/timeline';
import {
  DetailPageLayout,
  DetailSection,
  DetailGrid,
  DetailItem,
  ConfirmDialog,
} from '@/components/shared';
import { logQuotationActivity } from '@/lib/quotations';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { QuotationForm } from '@/components/quotations/quotation-form';
import { QuotationVersionsPanel } from '@/components/quotations/quotation-versions-panel';
import {
  fetchQuotationVersions,
  supersededBy,
  type QuotationVersion,
} from '@/lib/quotation-versions';

const STATUS_COLORS: Record<string, string> = {
  Pending: 'bg-amber-600 text-white shadow-sm border-transparent',
  Sent: 'bg-blue-600 text-white shadow-sm border-transparent',
  Approved: 'bg-emerald-600 text-white shadow-sm border-transparent',
  Rejected: 'bg-red-600 text-white shadow-sm border-transparent',
};

export default function QuotationViewPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const quotationId = resolvedParams.id;

  // Opening the record is what clears its highlight on the list.
  useMarkRecordSeen("quotation", quotationId);
  
  const supabase = createClient();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [quotation, setQuotation] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [versions, setVersions] = useState<QuotationVersion[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [formQuotationId, setFormQuotationId] = useState<string | undefined>(undefined);
  const [formCloneId, setFormCloneId] = useState<string | undefined>(undefined);
  const [formVersionId, setFormVersionId] = useState<string | undefined>(undefined);

  const fetchData = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('quotations')
      .select('*, contact:contacts!quotations_contact_id_fkey(*)')
      .eq('id', quotationId)
      .single();

    if (error || !data) {
      toast.error('Failed to load quotation');
      router.push('/quotations');
      return;
    }
    
    setQuotation(data);

    const { data: itemsData } = await supabase
      .from('quotation_items')
      .select('*')
      .eq('quotation_id', quotationId)
      .order('position');
    setItems(itemsData || []);

    // The whole version family in one round trip, so an older version stays
    // reachable from the newer one that replaced it.
    setVersions(await fetchQuotationVersions(supabase, quotationId));
    
    // Fetch tasks and activities for timeline
    const [taskRes, actRes] = await Promise.all([
      supabase.from('tasks').select('*').eq('quotation_id', quotationId).order('created_at', { ascending: false }),
      supabase.from('module_activities').select('*').eq('module_name', 'quotation').eq('record_id', quotationId).order('created_at', { ascending: false })
    ]);
    
    if (taskRes.data) setTasks(taskRes.data);
    
    if (actRes.data && actRes.data.length > 0) {
      const userIds = Array.from(new Set(actRes.data.map((a: any) => a.user_id).filter(Boolean)));
      if (userIds.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('user_id, full_name, email').in('user_id', userIds);
        const profileMap = (profiles || []).reduce((acc: any, p: any) => {
          acc[p.user_id] = p;
          return acc;
        }, {});
        
        const enrichedActivities = actRes.data.map((a: any) => ({
          ...a,
          user: profileMap[a.user_id] || null
        }));
        setActivities(enrichedActivities);
      } else {
        setActivities(actRes.data);
      }
    } else {
      setActivities([]);
    }
    
    if (data && !data.is_read) {
      // Fire and forget update
      supabase.from('quotations').update({ is_read: true }).eq('id', quotationId).then();
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [quotationId, router, supabase]);

  const changeStatus = async (newStatus: string) => {
    setActionLoading(true);
    const { error } = await supabase.from('quotations').update({ status: newStatus }).eq('id', quotation.id);
    if (!error) {
      toast.success(`Quotation marked as ${newStatus}`);
      await logQuotationActivity(supabase, quotation.id, 'status_changed', { new_status: newStatus });
      setQuotation({ ...quotation, status: newStatus });
      fetchData();
    } else {
      toast.error('Failed to update status');
    }
    setActionLoading(false);
  };

  const handleDuplicate = async (isVersion = false) => {
    if (!quotation) return;
    if (isVersion) {
      setFormQuotationId(undefined);
      setFormCloneId(undefined);
      setFormVersionId(quotation.id);
      setFormOpen(true);
    } else {
      setFormQuotationId(undefined);
      setFormCloneId(quotation.id);
      setFormVersionId(undefined);
      setFormOpen(true);
    }
  };

  const handleDelete = () => setDeleteOpen(true);

  const doDelete = async () => {
    setDeleteOpen(false);
    setActionLoading(true);
    const { error } = await supabase.from('quotations').delete().eq('id', quotation.id);
    if (!error) {
      toast.success('Quotation deleted');
      router.push('/quotations');
    } else {
      toast.error('Failed to delete quotation');
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <Loader2 className="size-8 animate-spin text-primary" />
        <p className="text-muted-foreground animate-pulse">Loading quotation...</p>
      </div>
    );
  }

  // The version that replaced this one, when viewing an older version. Null on
  // the newest version and on a quotation that was never versioned.
  const replacedBy = quotation ? supersededBy(versions, quotation.id) : null;

  return (
    // Was `px-6 mt-6` on top of the gutter the workspace <main> already
    // applies, so a quotation sat 40px in from every other page.
    <DetailPageLayout
      title={quotation.quotation_number}
      onBack={() => router.push('/quotations')}
      badges={
        <>
          {quotation.version > 1 && (
            <Badge variant="secondary" className="font-normal text-caption px-2 py-0.5">
              v{quotation.version}
            </Badge>
          )}
          <Badge variant="outline" className={`font-medium px-2.5 py-0.5 ${STATUS_COLORS[quotation.status] || ''}`}>
            {quotation.status}
          </Badge>
        </>
      }
      meta={<span>Quotation for {quotation.contact?.name || 'Unknown'}</span>}
      actions={
        <>
          {/* Only from the newest version: branching off an older one would fork
              the chain, and the `QT-0034-2` numbering assumes a single line. */}
          {!replacedBy && (
            <Button variant="outline" size="sm" onClick={() => handleDuplicate(true)} disabled={actionLoading} className="font-semibold text-muted-foreground uppercase rounded-sm border-border hover:bg-muted">
              MAKE VERSION
            </Button>
          )}
          
          {(quotation.status === 'Draft' || quotation.status === 'Pending' || quotation.status === 'Sent') && (
            <>
              <Button size="sm" onClick={() => changeStatus('Approved')} disabled={actionLoading} className="font-semibold uppercase rounded-sm bg-emerald-500 hover:bg-emerald-600 text-white">
                APPROVE
              </Button>
              <Button size="sm" onClick={() => changeStatus('Rejected')} disabled={actionLoading} className="font-semibold uppercase rounded-sm bg-red-500 hover:bg-red-600 text-white">
                REJECT
              </Button>
            </>
          )}

          <Button 
            size="icon" 
            className="rounded-sm bg-blue-500 hover:bg-blue-600 text-white h-9 w-9" 
            disabled={actionLoading}
            onClick={() => {
              setFormQuotationId(quotation.id);
              setFormCloneId(undefined);
              setFormVersionId(undefined);
              setFormOpen(true);
            }}
          >
            <Pencil className="size-4" />
          </Button>

          <Button variant="outline" size="icon" onClick={() => handleDuplicate(false)} disabled={actionLoading} className="rounded-sm border-border text-muted-foreground hover:bg-muted h-9 w-9">
            <Copy className="size-4" />
          </Button>

          <Button variant="outline" size="icon" onClick={() => handleDelete()} disabled={actionLoading} className="rounded-sm border-border text-muted-foreground hover:bg-muted h-9 w-9">
            <X className="size-4" />
          </Button>

          <PrintSizeMenu href={`/print/quotation/${quotation.id}`} />
        </>
      }
    >

      {replacedBy && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <span className="text-foreground">
            You are viewing <span className="font-medium">v{quotation.version}</span>. This
            quotation was superseded by{' '}
            <span className="font-medium">v{replacedBy.version}</span> (
            {replacedBy.quotation_number}).
          </span>
          <Link href={`/quotations/${replacedBy.id}`}>
            <Button variant="outline" size="sm" className="h-7 text-xs">
              Open latest <ArrowUpRight className="ml-1 size-3.5" />
            </Button>
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <DetailSection
            title={
              <span className="flex items-center gap-2">
                <FileText className="size-5 text-muted-foreground" />
                Quotation Details
              </span>
            }
          >
            <DetailGrid cols={4}>
              <DetailItem label="Date" value={new Date(quotation.date).toLocaleDateString()} />
              <DetailItem
                label="Valid Until"
                value={quotation.valid_until ? new Date(quotation.valid_until).toLocaleDateString() : undefined}
              />
              <DetailItem span={2} label="Quotation For">
                <div className="flex flex-col">
                  <span>{quotation.contact?.name}</span>
                  {quotation.contact?.company && (
                    <span className="text-caption font-normal text-muted-foreground">{quotation.contact.company}</span>
                  )}
                  {quotation.contact?.email && (
                    <span className="text-caption font-normal text-muted-foreground">{quotation.contact.email}</span>
                  )}
                </div>
              </DetailItem>
            </DetailGrid>
          </DetailSection>

          <DetailSection title="Line Items">
            <div className="border border-border rounded-md overflow-hidden">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Quantity</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Tax</TableHead>
                    <TableHead className="text-right">Subtotal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">
                        <div className="flex flex-col">
                          <span>{item.product_name}</span>
                        </div>
                      </TableCell>
                      <TableCell>{item.quantity}</TableCell>
                      <TableCell>{item.unit}</TableCell>
                      <TableCell className="text-right">₹{Number(item.price).toFixed(2)}</TableCell>
                      <TableCell className="text-right">{item.tax_rate}%</TableCell>
                      <TableCell className="text-right font-medium">₹{Number(item.sub_total).toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="mt-6 flex justify-end">
              <div className="w-full max-w-xs space-y-3 text-sm">
                <div className="flex justify-between items-center text-muted-foreground">
                  <span>Sub Total</span>
                  <span>₹{Number(quotation.sub_total).toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center text-muted-foreground">
                  <span>Total Tax</span>
                  <span>₹{Number(quotation.tax_total).toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between border-t border-border pt-3 font-bold text-page-title text-primary">
                  <span>Total Amount</span>
                  <span>₹{Number(quotation.total_amount).toFixed(2)}</span>
                </div>
              </div>
            </div>
          </DetailSection>

          {quotation.terms_conditions && (
            <DetailSection title="Terms &amp; Conditions">
              <div
                className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground" 
                dangerouslySetInnerHTML={{ __html: sanitizeRichText(quotation.terms_conditions) }}
              />
            </DetailSection>
          )}
        </div>

        <div className="w-full lg:w-[400px] space-y-6">
          <QuotationVersionsPanel versions={versions} currentId={quotation.id} />
          <Timeline 
            moduleName="quotation" 
            recordId={quotation.id} 
            tasks={tasks} 
            activities={activities} 
            onRefresh={fetchData} 
          />
        </div>
      </div>

      {formOpen && (
        <QuotationForm
          open={formOpen}
          onOpenChange={setFormOpen}
          quotationId={formQuotationId}
          initialData={formQuotationId ? quotation : undefined}
          cloneId={formCloneId}
          versionId={formVersionId}
          onSaved={(newId) => {
            if (newId && newId !== quotationId) {
              router.push(`/quotations/${newId}`);
            } else {
              fetchData();
            }
          }}
        />
      )}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this quotation?"
        description="This permanently deletes the quotation. It cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        loading={actionLoading}
        onConfirm={doDelete}
      />
    </DetailPageLayout>
  );
}
