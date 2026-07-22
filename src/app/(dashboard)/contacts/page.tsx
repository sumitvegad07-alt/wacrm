'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type { Contact, Tag, ContactTag, CustomField } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  Upload,
  SlidersHorizontal,
  Loader2,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react';
import { ContactForm } from '@/components/contacts/contact-form';
import { ImportModal } from '@/components/contacts/import-modal';
import { CustomFieldsManager } from '@/components/contacts/custom-fields-manager';
import { useCan } from '@/hooks/use-can';
import { useAuth } from '@/hooks/use-auth';
import { GatedButton } from '@/components/ui/gated-button';
import { DataTable } from '@/components/ui/data-table/data-table';
import { ColumnDef, FilterState } from '@/components/ui/data-table/data-table-types';
import { isDateInFilter } from "@/lib/date-filters";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

interface ContactWithData extends Contact {
  tags?: Tag[];
  [key: string]: any;
}

export default function ContactsPage() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const canEdit = useCan('send-messages');
  const canEditSettings = useCan('edit-settings');
  const { accountId } = useAuth();

  const [contacts, setContacts] = useState<ContactWithData[]>([]);
  const [hierarchy, setHierarchy] = useState<{ enabled: boolean; levels: { position: number; name: string; color?: string }[] }>({ enabled: false, levels: [] });
  const [loading, setLoading] = useState(true);
  
  // Modals
  const [formOpen, setFormOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [editContactTags, setEditContactTags] = useState<ContactTag[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [customFieldsOpen, setCustomFieldsOpen] = useState(false);
  
  // Deletion Modals
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  // DataTable state
  const [filterState, setFilterState] = useState<FilterState>({});
  const [globalSearch, setGlobalSearch] = useState("");
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(new Set());

  // Lookups
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [{ data: contactsData }, { data: tagsData }, { data: fieldsData }] = await Promise.all([
      supabase.from('contacts').select('*').order('created_at', { ascending: false }),
      supabase.from('tags').select('*').order('name'),
      supabase.from('custom_fields').select('*').eq('module_name', 'contact')
    ]);

    setAllTags(tagsData || []);
    setCustomFields(fieldsData || []);

    // Order-hierarchy config → drives the optional Customer Level column.
    if (accountId) {
      const { data: acct } = await supabase.from('accounts').select('settings').eq('id', accountId).single();
      const os = acct?.settings?.order_settings;
      setHierarchy({ enabled: !!os?.hierarchy_enabled, levels: Array.isArray(os?.levels) ? os.levels : [] });
    }

    let enhancedContacts = contactsData || [];

    if (contactsData && contactsData.length > 0) {
      const contactIds = contactsData.map(c => c.id);
      
      const [{ data: contactTags }, { data: valuesData }] = await Promise.all([
        supabase.from('contact_tags').select('contact_id, tag_id').in('contact_id', contactIds),
        supabase.from('contact_custom_values').select('*').in('contact_id', contactIds)
      ]);

      const tagsByContact: Record<string, Tag[]> = {};
      const tagsMap: Record<string, Tag> = {};
      tagsData?.forEach(t => tagsMap[t.id] = t);

      contactTags?.forEach((ct) => {
        if (!tagsByContact[ct.contact_id]) tagsByContact[ct.contact_id] = [];
        if (tagsMap[ct.tag_id]) tagsByContact[ct.contact_id].push(tagsMap[ct.tag_id]);
      });

      enhancedContacts = contactsData.map(contact => {
        const contactValues = valuesData?.filter((v: any) => v.contact_id === contact.id) || [];
        const customData: any = {};
        contactValues.forEach((v: any) => {
          customData[`cf_${v.custom_field_id}`] = v.value;
        });
        return { 
          ...contact, 
          tags: tagsByContact[contact.id] || [],
          ...customData 
        };
      });
    }

    setContacts(enhancedContacts);
    setLoading(false);
  }, [supabase, accountId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (searchParams.get('new') === 'true') {
      openAddForm();
      router.replace('/contacts');
    }
  }, [searchParams, router]);

  function openAddForm() {
    setEditContact(null);
    setEditContactTags([]);
    setFormOpen(true);
  }

  async function openEditForm(contact: Contact) {
    const { data } = await supabase
      .from('contact_tags')
      .select('*')
      .eq('contact_id', contact.id);
    setEditContact(contact);
    setEditContactTags(data ?? []);
    setFormOpen(true);
  }

  function confirmDelete(contact: Contact) {
    setDeleteTarget(contact);
    setDeleteConfirmOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);

    const { error } = await supabase
      .from('contacts')
      .delete()
      .eq('id', deleteTarget.id);

    if (error) {
      toast.error('Failed to delete contact');
    } else {
      toast.success('Customer deleted');
      fetchData();
    }

    setDeleting(false);
    setDeleteConfirmOpen(false);
    setDeleteTarget(null);
  }

  async function handleBulkDelete() {
    const ids = Array.from(selectedContacts);
    if (ids.length === 0) return;
    setDeleting(true);

    const { error } = await supabase.from('contacts').delete().in('id', ids);

    if (error) {
      toast.error('Failed to delete contacts');
    } else {
      toast.success(`${ids.length} contact${ids.length === 1 ? '' : 's'} deleted`);
      setSelectedContacts(new Set());
      fetchData();
    }

    setDeleting(false);
    setBulkDeleteOpen(false);
  }

  const columns: ColumnDef<ContactWithData>[] = [
    {
      id: "name",
      label: "Company Name",
      type: "text",
      render: (contact) => (
        <span className="font-medium">{contact.company || contact.name || <span className="text-muted-foreground italic">Unnamed</span>}</span>
      )
    },
    {
      id: "contact_person",
      label: "Contact Person",
      type: "text",
      visibleByDefault: false,
      render: (contact) => <span>{contact.name || "-"}</span>
    },
    {
      id: "phone",
      label: "Phone",
      type: "text",
      render: (contact) => <span className="font-mono text-xs">{contact.phone}</span>
    },
    {
      id: "email",
      label: "Email",
      type: "text",
      render: (contact) => <span>{contact.email || "-"}</span>
    },
    {
      id: "address",
      label: "Address",
      type: "text",
      visibleByDefault: false,
      render: (contact) => <span className="text-sm">{contact.address || "-"}</span>
    },
    {
      id: "area",
      label: "Area",
      type: "text",
      visibleByDefault: false,
      render: (contact) => <span className="text-sm">{contact.area || "-"}</span>
    },
    {
      id: "city",
      label: "City",
      type: "text",
      visibleByDefault: false,
      render: (contact) => <span className="text-sm">{contact.city || "-"}</span>
    },
    {
      id: "state",
      label: "State",
      type: "text",
      visibleByDefault: false,
      render: (contact) => <span className="text-sm">{contact.state || "-"}</span>
    },
    {
      id: "country",
      label: "Country",
      type: "text",
      visibleByDefault: false,
      render: (contact) => <span className="text-sm">{contact.country || "-"}</span>
    },
    {
      id: "pincode",
      label: "Pincode",
      type: "text",
      visibleByDefault: false,
      render: (contact) => <span className="text-sm">{contact.pincode || "-"}</span>
    },
    {
      id: "created_at",
      label: "Created at",
      type: "date",
      render: (contact) => (
        <span className="text-muted-foreground text-sm">
          {new Date(contact.created_at).toLocaleDateString()}
        </span>
      )
    },
    {
      id: "actions",
      label: "",
      visibleByDefault: true,
      render: (contact) => (
        <DropdownMenu>
          <DropdownMenuTrigger 
            render={<Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" />}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-popover border-border">
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openEditForm(contact); }} className="text-popover-foreground">
              <Pencil className="size-4 mr-2" /> Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem variant="destructive" onClick={(e) => { e.stopPropagation(); confirmDelete(contact); }}>
              <Trash2 className="size-4 mr-2" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    }
  ];

  // Customer Level column — only when the account uses order hierarchy.
  // Inserted before the trailing actions column.
  if (hierarchy.enabled) {
    columns.splice(columns.length - 1, 0, {
      id: "hierarchy_level",
      label: "Customer Level",
      type: "select",
      options: hierarchy.levels.map((lvl) => ({ label: `Level ${lvl.position} — ${lvl.name}`, value: String(lvl.position) })),
      visibleByDefault: true,
      render: (contact) => {
        const lvl = hierarchy.levels.find((l) => l.position === contact.hierarchy_level);
        if (!lvl) return <span className="text-muted-foreground">-</span>;
        const color = lvl.color || "#6b7280";
        return (
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap" style={{ backgroundColor: color + '22', color }}>
            {lvl.name}
          </span>
        );
      }
    });
  }

  // Append custom fields to columns
  customFields.forEach(cf => {
    let type: any = "text";
    let options: any[] = [];
    
    if (cf.field_type === 'dropdown' || cf.field_type === 'radio' || cf.field_type === 'multi-select') {
      type = "select";
      const uniqueVals = Array.from(new Set(contacts.map(c => c[`cf_${cf.id}`]).filter(Boolean)));
      options = uniqueVals.map(val => ({ label: val, value: val }));
    } else if (cf.field_type === 'date') {
      type = "date";
    }

    columns.splice(columns.length - 1, 0, {
      id: `cf_${cf.id}`,
      label: cf.field_name,
      type: type,
      options: options.length > 0 ? options : undefined,
      visibleByDefault: false,
      render: (contact) => {
        const val = contact[`cf_${cf.id}`];
        if (!val) return <span className="text-muted-foreground">-</span>;
        
        if (cf.field_type === 'checkbox') {
          return <span>{val === 'true' ? 'Yes' : 'No'}</span>;
        }
        if (cf.field_type === 'attachment') {
          return <a href={val} target="_blank" rel="noreferrer" className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>View</a>;
        }
        return <span>{val}</span>;
      }
    });
  });

  const filteredContacts = useMemo(() => {
    return contacts.filter(contact => {
      // Global search (company name is primary, then person, phone, email)
      if (globalSearch) {
        const q = globalSearch.toLowerCase();
        const hit =
          contact.company?.toLowerCase().includes(q) ||
          contact.name?.toLowerCase().includes(q) ||
          contact.phone?.includes(globalSearch) ||
          contact.email?.toLowerCase().includes(q);
        if (!hit) return false;
      }

      // Column filters
      for (const [colId, val] of Object.entries(filterState)) {
        if (val === null || val === undefined || val === "" || (Array.isArray(val) && val.length === 0)) continue;

        if (colId === "name") {
          // "Company Name" column filters on the company field.
          if (!contact.company?.toLowerCase().includes((val as string).toLowerCase())) return false;
        } else if (colId === "contact_person") {
          if (!contact.name?.toLowerCase().includes((val as string).toLowerCase())) return false;
        } else if (colId === "phone") {
          if (!contact.phone?.includes(val as string)) return false;
        } else if (colId === "email") {
          if (!contact.email?.toLowerCase().includes((val as string).toLowerCase())) return false;
        } else if (colId === "company") {
          if (!contact.company?.toLowerCase().includes((val as string).toLowerCase())) return false;
        } else if (["address", "area", "city", "state", "country", "pincode"].includes(colId)) {
          const field = (contact as Record<string, unknown>)[colId];
          if (typeof field !== "string" || !field.toLowerCase().includes((val as string).toLowerCase())) return false;
        } else if (colId === "created_at") {
          if (!isDateInFilter(contact.created_at, val as string | string[])) return false;
        } else if (colId.startsWith("cf_")) {
          const cfVal = contact[colId];
          const typeOfCf = customFields.find(f => `cf_${f.id}` === colId)?.field_type;
          
          if (typeOfCf === 'date') {
            if (!isDateInFilter(cfVal, val as string | string[])) return false;
          } else if (typeOfCf === 'dropdown' || typeOfCf === 'radio' || typeOfCf === 'multi-select') {
             if (!(val as string[]).includes(cfVal)) return false;
          } else {
             if (!cfVal?.toLowerCase().includes((val as string).toLowerCase())) return false;
          }
        }
      }
      return true;
    });
  }, [contacts, filterState, globalSearch]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Customers</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your contact list.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canEditSettings && (
            <Button variant="outline" onClick={() => setCustomFieldsOpen(true)} className="border-border text-muted-foreground hover:bg-muted">
              <SlidersHorizontal className="size-4 mr-2" /> Custom fields
            </Button>
          )}
          <GatedButton variant="outline" canAct={canEdit} gateReason="add or import contacts" onClick={() => setImportOpen(true)} className="border-border text-muted-foreground hover:bg-muted">
            <Upload className="size-4 mr-2" /> Import
          </GatedButton>
          <GatedButton canAct={canEdit} gateReason="add or import contacts" onClick={openAddForm} className="bg-primary hover:bg-primary/90 text-primary-foreground">
            <Plus className="size-4 mr-2" /> Add Customer
          </GatedButton>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 bg-card p-4 rounded-xl border border-border">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search contacts globally..." 
            className="pl-9"
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
          />
        </div>
        {selectedContacts.size > 0 && (
          <div className="flex items-center gap-2">
             <span className="text-sm font-medium">{selectedContacts.size} selected</span>
             <Button variant="destructive" size="sm" onClick={() => setBulkDeleteOpen(true)}>
               <Trash2 className="size-4 mr-2" /> Delete Selected
             </Button>
          </div>
        )}
      </div>

      <DataTable
        columns={columns}
        data={filteredContacts}
        filterState={filterState}
        onFilterChange={(id, val) => setFilterState(prev => ({...prev, [id]: val}))}
        storageKey="wacrm_contacts_table_columns"
        isLoading={loading}
        rowKey={(contact) => contact.id}
        onRowClick={(contact) => router.push(`/contacts/${contact.id}`)}
        selection={{
          selectedIds: selectedContacts,
          onSelectAll: (checked) => setSelectedContacts(checked ? new Set(filteredContacts.map(c => c.id)) : new Set()),
          onSelect: (id, checked) => setSelectedContacts(prev => {
             const next = new Set(prev);
             if (checked) next.add(id); else next.delete(id);
             return next;
          })
        }}
      />

      <ContactForm open={formOpen} onOpenChange={setFormOpen} contact={editContact} contactTags={editContactTags} onSaved={fetchData} onViewExisting={(id) => { setFormOpen(false); router.push(`/contacts/${id}`); }} />
      <ImportModal open={importOpen} onOpenChange={setImportOpen} onImported={fetchData} />
      {canEditSettings && <CustomFieldsManager open={customFieldsOpen} onOpenChange={setCustomFieldsOpen} />}

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Customer</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <span className="font-medium text-popover-foreground">{deleteTarget?.name || deleteTarget?.phone}</span>? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="size-4 animate-spin mr-2" />} Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {selectedContacts.size} Customers</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {selectedContacts.size} contacts? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleBulkDelete} disabled={deleting}>
              {deleting && <Loader2 className="size-4 animate-spin mr-2" />} Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
