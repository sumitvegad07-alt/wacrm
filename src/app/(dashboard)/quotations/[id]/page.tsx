'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Edit, Copy, Check, X, FileText, Loader2, Send, FilePlus2, Printer, Pencil } from 'lucide-react';
import Link from 'next/link';
import { QuotationTimeline } from '@/components/quotations/quotation-timeline';
import { Timeline } from '@/components/shared/timeline';
import { logQuotationActivity } from '@/lib/quotations';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { QuotationForm } from '@/components/quotations/quotation-form';

const STATUS_COLORS: Record<string, string> = {
  Pending: 'bg-slate-100 text-slate-700 border-slate-200',
  Sent: 'bg-blue-100 text-blue-700 border-blue-200',
  Approved: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  Rejected: 'bg-red-100 text-red-700 border-red-200',
};

export default function QuotationViewPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const quotationId = resolvedParams.id;
  
  const supabase = createClient();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [quotation, setQuotation] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);

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

  const handleDelete = async () => {
    if (!window.confirm("Are you sure you want to delete this quotation?")) return;
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

  return (
    <div className="space-y-6 pb-20 max-w-7xl mx-auto px-6 mt-6">
      <header className="flex flex-col sm:flex-row shrink-0 items-start sm:items-center justify-between gap-4 bg-card p-6 rounded-lg border border-border shadow-sm">
        <div className="flex items-center gap-4">
          <Link href="/quotations">
            <Button variant="outline" size="icon" className="border-border text-muted-foreground hover:text-foreground">
              <ArrowLeft className="size-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                {quotation.quotation_number}
              </h1>
              {quotation.version > 1 && (
                <Badge variant="secondary" className="font-normal text-xs px-2 py-0.5">
                  v{quotation.version}
                </Badge>
              )}
              <Badge variant="outline" className={`font-medium px-2.5 py-0.5 ${STATUS_COLORS[quotation.status] || ''}`}>
                {quotation.status}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Quotation for {quotation.contact?.name || 'Unknown'}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => handleDuplicate(true)} disabled={actionLoading} className="font-semibold text-muted-foreground uppercase rounded-sm border-border hover:bg-muted">
            MAKE VERSION
          </Button>
          
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

          <Button variant="outline" size="icon" onClick={() => window.open(`/print/quotation/${quotation.id}`, '_blank')} disabled={actionLoading} className="rounded-sm border-border text-muted-foreground hover:bg-muted h-9 w-9">
            <Printer className="size-4" />
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-card border border-border rounded-lg p-6">
            <h3 className="text-lg font-medium mb-6 flex items-center gap-2 border-b border-border pb-4">
              <FileText className="size-5 text-muted-foreground" />
              Quotation Details
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Date</p>
                <p className="font-medium">{new Date(quotation.date).toLocaleDateString()}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Valid Until</p>
                <p className="font-medium">{quotation.valid_until ? new Date(quotation.valid_until).toLocaleDateString() : '-'}</p>
              </div>
              <div className="col-span-2">
                <p className="text-sm font-medium text-muted-foreground mb-1">Quotation For</p>
                <div className="flex flex-col">
                  <span className="font-medium">{quotation.contact?.name}</span>
                  {quotation.contact?.company && (
                    <span className="text-xs text-muted-foreground">{quotation.contact.company}</span>
                  )}
                  {quotation.contact?.email && (
                    <span className="text-xs text-muted-foreground">{quotation.contact.email}</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg p-6">
            <h3 className="text-lg font-medium mb-4">Line Items</h3>
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
                <div className="pt-3 border-t border-border flex justify-between items-center font-bold text-lg text-primary">
                  <span>Total Amount</span>
                  <span>₹{Number(quotation.total_amount).toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>

          {quotation.terms_conditions && (
            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="text-lg font-medium mb-4">Terms & Conditions</h3>
              <div 
                className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground" 
                dangerouslySetInnerHTML={{ __html: quotation.terms_conditions }} 
              />
            </div>
          )}
        </div>

        <div className="w-full lg:w-[400px]">
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
    </div>
  );
}
