'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type { Quotation } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Search,
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Loader2,
  FileText,
  ChevronLeft,
  ChevronRight,
  Copy,
  Send,
  Check,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { Checkbox } from '@/components/ui/checkbox';
import { logQuotationActivity } from '@/lib/quotations';
import { QuotationForm } from '@/components/quotations/quotation-form';

const PAGE_SIZE = 25;

const STATUS_COLORS: Record<string, string> = {
  Pending: 'bg-slate-100 text-slate-700 border-slate-200',
  Sent: 'bg-blue-100 text-blue-700 border-blue-200',
  Approved: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  Rejected: 'bg-red-100 text-red-700 border-red-200',
};

export default function QuotationsPage() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [quotations, setQuotations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Form State
  const [formOpen, setFormOpen] = useState(false);
  const [formQuotationId, setFormQuotationId] = useState<string | undefined>(undefined);
  const [formCloneId, setFormCloneId] = useState<string | undefined>(undefined);
  const [formVersionId, setFormVersionId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (searchParams.get('new') === 'true') {
      setFormQuotationId(undefined);
      setFormCloneId(undefined);
      setFormVersionId(undefined);
      setFormOpen(true);
      router.replace('/quotations');
    }
  }, [searchParams, router]);

  const fetchQuotations = useCallback(async () => {
    setLoading(true);
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let matchingContactIds: string[] = [];
    if (search.trim()) {
      const { data: contacts } = await supabase
        .from('contacts')
        .select('id')
        .ilike('name', `%${search.trim()}%`);
      if (contacts && contacts.length > 0) {
        matchingContactIds = contacts.map(c => c.id);
      }
    }

    let query = supabase
      .from('quotations')
      .select('*, contact:contacts!quotations_contact_id_fkey(name, company)', { count: 'exact' })
      .eq('is_latest_version', true);

    if (search.trim()) {
      if (matchingContactIds.length > 0) {
        query = query.or(`quotation_number.ilike.%${search.trim()}%,contact_id.in.(${matchingContactIds.join(',')})`);
      } else {
        query = query.ilike('quotation_number', `%${search.trim()}%`);
      }
    }

    query = query.order('created_at', { ascending: false }).range(from, to);

    const { data, count, error } = await query;

    if (error) {
      toast.error('Failed to load quotations');
    } else {
      setQuotations(data || []);
      setTotalCount(count || 0);
      setSelectedIds(new Set());
    }
    setLoading(false);
  }, [supabase, page, search]);

  useEffect(() => {
    fetchQuotations();
  }, [fetchQuotations]);

  const changeStatus = async (id: string, newStatus: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const { error } = await supabase.from('quotations').update({ status: newStatus }).eq('id', id);
    if (!error) {
      toast.success(`Quotation marked as ${newStatus}`);
      await logQuotationActivity(supabase, id, 'status_changed', { new_status: newStatus });
      fetchQuotations();
    } else {
      toast.error('Failed to update status');
    }
  };

  function confirmDelete(quotation: any) {
    setDeleteTarget(quotation);
    setDeleteConfirmOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);

    const { error } = await supabase
      .from('quotations')
      .delete()
      .eq('id', deleteTarget.id);

    if (error) {
      toast.error('Failed to delete quotation');
    } else {
      toast.success('Quotation deleted');
      fetchQuotations();
    }

    setDeleting(false);
    setDeleteConfirmOpen(false);
    setDeleteTarget(null);
  }

  function toggleSelection(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  }

  function toggleAllSelection() {
    if (selectedIds.size === quotations.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(quotations.map((q) => q.id)));
    }
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Are you sure you want to delete ${selectedIds.size} selected quotation(s)? This action cannot be undone.`)) return;
    
    setBulkActionLoading(true);
    const ids = Array.from(selectedIds);
    const { error } = await supabase.from('quotations').delete().in('id', ids);
    if (!error) {
      toast.success(`Deleted ${ids.length} quotations`);
      fetchQuotations();
    } else {
      toast.error('Failed to delete quotations');
    }
    setBulkActionLoading(false);
  }

  async function handleSelectAllMatching() {
    if (!search.trim()) return;
    setBulkActionLoading(true);
    
    // Fetch all matching contact IDs first
    let matchingContactIds: string[] = [];
    const { data: contacts } = await supabase
      .from('contacts')
      .select('id')
      .ilike('name', `%${search.trim()}%`);
      
    if (contacts && contacts.length > 0) {
      matchingContactIds = contacts.map(c => c.id);
    }

    let query = supabase.from('quotations').select('id').eq('is_latest_version', true);
    
    if (matchingContactIds.length > 0) {
      query = query.or(`quotation_number.ilike.%${search.trim()}%,contact_id.in.(${matchingContactIds.join(',')})`);
    } else {
      query = query.ilike('quotation_number', `%${search.trim()}%`);
    }

    const { data } = await query;
    if (data) {
      setSelectedIds(new Set(data.map(d => d.id)));
      toast.success(`Selected all ${data.length} matching quotations`);
    }
    setBulkActionLoading(false);
  }


  const handleClone = (quotation: any) => {
    setFormQuotationId(undefined);
    setFormCloneId(quotation.id);
    setFormVersionId(undefined);
    setFormOpen(true);
  };

  const handleCreateVersion = (quotation: any) => {
    setFormQuotationId(undefined);
    setFormCloneId(undefined);
    setFormVersionId(quotation.id);
    setFormOpen(true);
  };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const hasNext = page < totalPages - 1;
  const hasPrev = page > 0;

  return (
    <div className="space-y-6">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-6 py-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Quotations</h1>
          <p className="text-sm text-muted-foreground">Manage and track your quotations.</p>
        </div>
        <div className="flex gap-2">
          {process.env.NODE_ENV === 'development' && (
            <Button 
              variant="secondary"
              className="gap-2" 
              onClick={async () => {
                toast.loading('Seeding 20 quotations...', { id: 'seed' });
                const { data: contacts } = await supabase.from('contacts').select('id').limit(1);
                if (!contacts || contacts.length === 0) {
                  toast.error('Create a contact first', { id: 'seed' });
                  return;
                }
                const contactId = contacts[0].id;
                
                const { data: userData } = await supabase.auth.getUser();
                if (!userData?.user) return;
                
                const { data: member } = await supabase.from('profiles').select('account_id').eq('user_id', userData.user.id).single();
                if (!member) {
                  toast.error('Failed to get account information', { id: 'seed' });
                  return;
                }
                
                const dummyQuotations = Array.from({ length: 20 }).map((_, i) => ({
                  account_id: member.account_id,
                  user_id: userData.user.id,
                  contact_id: contactId,
                  date: new Date().toISOString().split('T')[0],
                  status: ['Pending', 'Sent', 'Approved', 'Rejected'][Math.floor(Math.random() * 4)],
                  sub_total: 100 * (i + 1),
                  total_amount: 100 * (i + 1),
                }));
                
                const { error } = await supabase.from('quotations').insert(dummyQuotations);
                if (error) {
                  toast.error('Failed to seed quotations', { id: 'seed' });
                } else {
                  toast.success('20 dummy quotations created!', { id: 'seed' });
                  fetchQuotations();
                }
              }}
            >
              Seed Dummy
            </Button>
          )}
          <Button 
            className="gap-2"
            onClick={() => {
              setFormQuotationId(undefined);
              setFormCloneId(undefined);
              setFormVersionId(undefined);
              setFormOpen(true);
            }}
          >
            <Plus className="size-4" />
            New Quotation
          </Button>
        </div>
      </header>

      <div className="flex flex-col sm:flex-row gap-2 px-6">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Search by number or contact..."
            className="pl-8 bg-card border-border text-foreground placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-md p-2 px-4 mx-6 shadow-sm animate-in fade-in slide-in-from-top-2">
          <span className="text-sm font-medium text-primary">
            {selectedIds.size} quotation{selectedIds.size > 1 ? 's' : ''} selected
          </span>
          {search.trim() && totalCount > selectedIds.size && (
            <>
              <div className="h-4 w-px bg-primary/20 mx-2" />
              <Button variant="ghost" size="sm" disabled={bulkActionLoading} onClick={handleSelectAllMatching} className="text-primary hover:text-primary hover:bg-primary/20">
                Select all {totalCount} matching quotations
              </Button>
            </>
          )}
          <div className="flex-1" />
          <Button variant="destructive" size="sm" disabled={bulkActionLoading} onClick={handleBulkDelete}>
            <Trash2 className="size-3.5 mr-2" />
            Delete Selected
          </Button>
        </div>
      )}

      <div className="rounded-lg border border-border overflow-hidden mx-6">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="w-12 text-center">
                <input
                  type="checkbox"
                  className="size-4 cursor-pointer accent-primary align-middle"
                  checked={quotations.length > 0 && selectedIds.size === quotations.length}
                  onChange={toggleAllSelection}
                />
              </TableHead>
              <TableHead className="text-muted-foreground">Quotation Number</TableHead>
              <TableHead className="text-muted-foreground">Date</TableHead>
              <TableHead className="text-muted-foreground">Quotation For</TableHead>
              <TableHead className="text-muted-foreground">Amount</TableHead>
              <TableHead className="text-muted-foreground">Status</TableHead>
              <TableHead className="text-muted-foreground hidden md:table-cell">Created By</TableHead>
              <TableHead className="text-muted-foreground w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow className="border-border">
                <TableCell colSpan={8} className="text-center py-12">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="size-6 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">Loading quotations...</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : quotations.length === 0 ? (
              <TableRow className="border-border">
                <TableCell colSpan={8} className="text-center py-12">
                  <div className="flex flex-col items-center gap-2">
                    <FileText className="size-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">No quotations found.</p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2 border-border text-muted-foreground hover:bg-muted"
                        onClick={() => {
                          setFormQuotationId(undefined);
                          setFormCloneId(undefined);
                          setFormVersionId(undefined);
                          setFormOpen(true);
                        }}
                      >
                        <Plus className="size-3.5 mr-2" />
                        Create a quotation
                      </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              quotations.map((quotation) => (
                <TableRow
                  key={quotation.id}
                  className={`border-border hover:bg-muted/50 cursor-pointer ${
                    !quotation.is_read ? 'bg-blue-500/5 font-semibold text-foreground dark:bg-blue-500/10' : ''
                  }`}
                  onClick={() => router.push(`/quotations/${quotation.id}`)}
                >
                  <TableCell onClick={(e) => e.stopPropagation()} className={`text-center ${!quotation.is_read ? 'border-l-4 border-l-blue-500 dark:border-l-blue-400' : 'border-l-4 border-l-transparent'}`}>
                    <input
                      type="checkbox"
                      className="size-4 cursor-pointer accent-primary align-middle"
                      checked={selectedIds.has(quotation.id)}
                      onChange={(e) => toggleSelection(quotation.id, e as any)}
                    />
                  </TableCell>
                  <TableCell className="font-medium text-foreground flex items-center gap-2">
                    {quotation.quotation_number}
                    {quotation.version > 1 && (
                      <Badge variant="secondary" className="font-normal text-[10px] px-1.5 py-0">
                        v{quotation.version}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {quotation.date ? new Date(quotation.date).toLocaleDateString() : '-'}
                  </TableCell>
                  <TableCell>
                    {quotation.contact ? (
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">{quotation.contact.name}</span>
                        {quotation.contact.company && (
                          <span className="text-xs text-muted-foreground">{quotation.contact.company}</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground italic">Unknown</span>
                    )}
                  </TableCell>
                  <TableCell className="font-medium text-foreground">
                    ₹{quotation.total_amount?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`font-normal ${STATUS_COLORS[quotation.status] || ''}`}>
                      {quotation.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden md:table-cell text-sm">
                    {quotation.creator?.full_name || quotation.creator?.email || '-'}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-foreground"
                          />
                        }
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-popover border-border">
                        <DropdownMenuItem 
                          className="text-popover-foreground focus:bg-muted focus:text-foreground cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/quotations/${quotation.id}`);
                          }}
                        >
                          <FileText className="size-4 mr-2" />
                          View
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          className="text-popover-foreground focus:bg-muted focus:text-foreground cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            setFormQuotationId(quotation.id);
                            setFormCloneId(undefined);
                            setFormVersionId(undefined);
                            setFormOpen(true);
                          }}
                        >
                          <Pencil className="size-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          className="text-popover-foreground focus:bg-muted focus:text-foreground cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCreateVersion(quotation);
                          }}
                        >
                          <Copy className="size-4 mr-2" />
                          New Version
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-border" />
                        
                        {quotation.status === 'Pending' && (
                          <DropdownMenuItem 
                            className="text-popover-foreground focus:bg-muted focus:text-foreground cursor-pointer"
                            onClick={(e) => changeStatus(quotation.id, 'Sent', e)}
                          >
                            <Send className="size-4 mr-2 text-blue-500" />
                            Mark Sent
                          </DropdownMenuItem>
                        )}
                        {(quotation.status === 'Pending' || quotation.status === 'Sent') && (
                          <>
                            <DropdownMenuItem 
                              className="text-popover-foreground focus:bg-muted focus:text-foreground cursor-pointer"
                              onClick={(e) => changeStatus(quotation.id, 'Approved', e)}
                            >
                              <Check className="size-4 mr-2 text-emerald-500" />
                              Approve
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                              className="text-popover-foreground focus:bg-muted focus:text-foreground cursor-pointer"
                              onClick={(e) => changeStatus(quotation.id, 'Rejected', e)}
                            >
                              <X className="size-4 mr-2 text-red-500" />
                              Reject
                            </DropdownMenuItem>
                          </>
                        )}
                        <DropdownMenuSeparator className="bg-border" />

                        <DropdownMenuItem
                          variant="destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            confirmDelete(quotation);
                          }}
                        >
                          <Trash2 className="size-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-6">
          <p className="text-xs text-muted-foreground">
            Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={!hasPrev}
              onClick={() => setPage((p) => p - 1)}
              className="border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-xs text-muted-foreground px-2">
              Page {page + 1} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={!hasNext}
              onClick={() => setPage((p) => p + 1)}
              className="border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">Delete Quotation</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Are you sure you want to delete{' '}
              <span className="text-popover-foreground font-medium">
                {deleteTarget?.quotation_number}
              </span>
              ? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="size-4 animate-spin mr-2" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {formOpen && (
        <QuotationForm
          open={formOpen}
          onOpenChange={setFormOpen}
          quotationId={formQuotationId}
          cloneId={formCloneId}
          versionId={formVersionId}
          onSaved={(newId) => {
            fetchQuotations();
            if (newId) router.push(`/quotations/${newId}`);
          }}
        />
      )}
    </div>
  );
}
