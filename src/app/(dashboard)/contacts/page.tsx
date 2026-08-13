'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type { Contact, Tag, ContactTag, CustomField } from '@/types';
import { appendCustomFieldColumns, matchesSearchableCustomFields, getVisibleTableColumns } from '@/lib/custom-fields';
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
import { PageLayout, PageHeader, PageToolbar, BulkActionBar, ConfirmDialog } from '@/components/shared';
import { MapPin } from 'lucide-react';
import {
  PointMapDialog,
  formatLatLng,
  hasPoint,
  type MapPoint,
} from '@/components/location-tracking/point-map-dialog';

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
  const { accountId, isModuleEnabled } = useAuth();
  const territoryEnabled = isModuleEnabled('territory');

  const [contacts, setContacts] = useState<ContactWithData[]>([]);
  const [hierarchy, setHierarchy] = useState<{ enabled: boolean; levels: { position: number; name: string; color?: string }[] }>({ enabled: false, levels: [] });
  const [loading, setLoading] = useState(true);
  
  // Modals
  const [formOpen, setFormOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [editContactTags, setEditContactTags] = useState<ContactTag[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  
  // Deletion Modals
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  // DataTable state
  const [filterState, setFilterState] = useState<FilterState>({});
  const [globalSearch, setGlobalSearch] = useState("");
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(new Set());
  const [mapPoint, setMapPoint] = useState<MapPoint | null>(null);

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

      // Territory names via a separate lookup (not a PostgREST embed) — the
      // contacts.territory_id FK is new, and embedding right after adding an FK
      // risks a stale schema-cache failure that would blank the whole list
      // (see CLAUDE Web.md, issue #294 pattern).
      const territoryNames: Record<string, string> = {};
      if (territoryEnabled) {
        const tids = [...new Set(contactsData.map((c) => c.territory_id).filter(Boolean))] as string[];
        if (tids.length > 0) {
          const { data: terrs } = await supabase.from('territories').select('id, name').in('id', tids);
          terrs?.forEach((t) => { territoryNames[t.id] = t.name; });
        }
      }

      enhancedContacts = contactsData.map(contact => {
        const contactValues = valuesData?.filter((v: any) => v.contact_id === contact.id) || [];
        const customData: any = {};
        contactValues.forEach((v: any) => {
          customData[`cf_${v.custom_field_id}`] = v.value;
        });
        return {
          ...contact,
          tags: tagsByContact[contact.id] || [],
          _territoryName: contact.territory_id ? (territoryNames[contact.territory_id] ?? null) : null,
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
      router.push('/contacts/new');
    }
  }, [searchParams, router]);

  function openAddForm() {
    router.push('/contacts/new');
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
      id: "tags",
      label: "Tags",
      type: "text",
      visibleByDefault: false,
      render: (contact) => (
        <div className="flex flex-wrap gap-1">
          {contact.tags?.map((t) => (
            <span key={t.id} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium" style={{ backgroundColor: `${t.color}20`, color: t.color }}>
              {t.name}
            </span>
          ))}
        </div>
      )
    },
    {
      id: "credit_limit",
      label: "Credit Limit",
      type: "number",
      visibleByDefault: false,
      render: (contact) => contact.credit_limit ? `₹${contact.credit_limit}` : "-"
    },
    {
      id: "credit_days",
      label: "Credit Days",
      type: "number",
      visibleByDefault: false,
      render: (contact) => contact.credit_days ? `${contact.credit_days} days` : "-"
    },
    {
      id: "opening_balance",
      label: "Opening Balance",
      type: "number",
      visibleByDefault: false,
      render: (contact) => contact.opening_balance ? `₹${contact.opening_balance}` : "-"
    },
    {
      id: "outstanding_amount",
      label: "Outstanding Amount",
      type: "number",
      visibleByDefault: false,
      render: (contact) => contact.outstanding_amount ? `₹${contact.outstanding_amount}` : "-"
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
      // The geo-tag captured when a rep tagged this customer on site.
      id: "latLng",
      label: "Latitude, Longitude",
      type: "text",
      render: (contact) => (
        <span className="font-mono text-xs whitespace-nowrap">
          {formatLatLng((contact as any).latitude, (contact as any).longitude)}
        </span>
      )
    },
    {
      id: "geoMap",
      label: "Geo Map",
      render: (contact) => (
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1 text-xs whitespace-nowrap"
          disabled={!hasPoint((contact as any).latitude, (contact as any).longitude)}
          onClick={(e) => {
            e.stopPropagation();
            setMapPoint({
              lat: (contact as any).latitude,
              lng: (contact as any).longitude,
              title: contact.company || contact.name || 'Customer',
              label: 'Customer geo-tag',
            });
          }}
        >
          <MapPin className="h-3 w-3" /> MAP
        </Button>
      )
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

  // Territory Master replaces the flat country/state/city/area columns when enabled.
  if (territoryEnabled) {
    for (const geoId of ['area', 'city', 'state', 'country']) {
      const idx = columns.findIndex((c) => c.id === geoId);
      if (idx >= 0) columns.splice(idx, 1);
    }
    columns.splice(columns.length - 1, 0, {
      id: 'territory',
      label: 'Territory',
      type: 'text',
      visibleByDefault: true,
      render: (contact) => {
        const c = contact as ContactWithData & { _territoryName?: string | null; needs_territory_review?: boolean };
        if (c._territoryName) return <span className="text-sm">{c._territoryName}</span>;
        if (c.needs_territory_review) return <span className="text-xs text-amber-600 dark:text-amber-500">needs review</span>;
        return <span className="text-muted-foreground">-</span>;
      },
    });
  }

  if (isModuleEnabled('payment')) {
    columns.splice(columns.length - 1, 0, 
      {
        id: "credit_limit",
        label: "Credit Limit",
        type: "text",
        visibleByDefault: false,
        render: (contact) => {
          const val = (contact as any).credit_limit;
          if (val == null) return <span className="text-muted-foreground">-</span>;
          return <span className="text-sm font-medium">{val}</span>;
        }
      },
      {
        id: "credit_days",
        label: "Credit Days",
        type: "text",
        visibleByDefault: false,
        render: (contact) => {
          const val = (contact as any).credit_days;
          if (val == null) return <span className="text-muted-foreground">-</span>;
          return <span className="text-sm font-medium">{val} days</span>;
        }
      },
      {
        id: "opening_balance",
        label: "Opening Balance",
        type: "text",
        visibleByDefault: false,
        render: (contact) => {
          const val = (contact as any).opening_balance;
          if (val == null) return <span className="text-muted-foreground">-</span>;
          return <span className="text-sm font-medium">{val}</span>;
        }
      },
      {
        id: "outstanding_amount",
        label: "Outstanding (Calculated)",
        type: "text",
        visibleByDefault: false,
        render: (contact) => {
          // Note: Full calculated outstanding requires an RPC or View join.
          // This placeholder shows the opening balance if outstanding is not joined.
          const val = (contact as any).outstanding_amount ?? (contact as any).opening_balance;
          if (val == null) return <span className="text-muted-foreground">-</span>;
          return <span className="text-sm font-medium text-amber-600 dark:text-amber-500">{val}</span>;
        }
      }
    );
  }

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
          <span className="inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-semibold text-white shadow-sm whitespace-nowrap" style={{ backgroundColor: color }}>
            {lvl.name}
          </span>
        );
      }
    });
  }

  // Transform base columns and append custom fields (controlled by admin show_in_table, sortable, filterable flags)
  const visibleColumns = useMemo(() => {
    return getVisibleTableColumns([...columns], customFields, contacts);
  }, [columns, customFields, contacts]);

  const filteredContacts = useMemo(() => {
    return contacts.filter(contact => {
      // Global search (company name is primary, then person, phone, email, and searchable custom fields)
      if (globalSearch) {
        const q = globalSearch.toLowerCase();
        const hit =
          contact.company?.toLowerCase().includes(q) ||
          contact.name?.toLowerCase().includes(q) ||
          contact.phone?.includes(globalSearch) ||
          contact.email?.toLowerCase().includes(q) ||
          matchesSearchableCustomFields(contact, customFields, globalSearch);
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
    <PageLayout>
      <BulkActionBar
        selectedCount={selectedContacts.size}
        onClear={() => setSelectedContacts(new Set())}
        actions={[
          {
            label: "Delete Selected",
            icon: <Trash2 className="size-3.5" />,
            variant: "destructive",
            onClick: () => setBulkDeleteOpen(true),
          },
        ]}
      />

      <DataTable
        columns={visibleColumns}
        data={filteredContacts}
        actions={
          <div className="flex items-center gap-2">
            <GatedButton variant="outline" size="sm" canAct={canEdit} gateReason="add or import contacts" onClick={() => setImportOpen(true)} className="h-7 text-xs px-2.5">
              <Upload className="size-3 mr-1" /> Import
            </GatedButton>
            <GatedButton size="sm" canAct={canEdit} gateReason="add or import contacts" onClick={openAddForm} className="h-7 text-xs px-2.5 bg-primary hover:bg-primary/90 text-primary-foreground">
              <Plus className="size-3 mr-1" /> Add Customer
            </GatedButton>
          </div>
        }
        filterState={filterState}
        onFilterChange={(id, val) => setFilterState(prev => ({...prev, [id]: val}))}
        // _v2: saved column layouts would otherwise hide the new geo-tag columns.
        storageKey="wacrm_contacts_table_columns_v2"
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

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Delete Customer"
        description={
          <>
            Are you sure you want to delete <span className="font-medium text-foreground">{deleteTarget?.name || deleteTarget?.phone}</span>? This action cannot be undone.
          </>
        }
        variant="danger"
        confirmLabel="Delete"
        loading={deleting}
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title={`Delete ${selectedContacts.size} Customers`}
        description={`Are you sure you want to delete ${selectedContacts.size} contacts? This action cannot be undone.`}
        variant="danger"
        confirmLabel="Delete"
        loading={deleting}
        onConfirm={handleBulkDelete}
      />

      <PointMapDialog point={mapPoint} onClose={() => setMapPoint(null)} />
    </PageLayout>
  );
}
