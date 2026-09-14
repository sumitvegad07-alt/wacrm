'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useRealtimeRefresh } from '@/hooks/use-realtime-refresh';
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
  Trash2,
  Eye,
  EyeOff,
} from 'lucide-react';
import { ContactForm } from '@/components/contacts/contact-form';
import { ImportWizard } from '@/components/import/import-wizard';
import { useCan } from '@/hooks/use-can';
import { useAuth } from '@/hooks/use-auth';
import { formatCurrency } from '@/lib/currency';
import { GatedButton } from '@/components/ui/gated-button';
import { DataTable } from '@/components/ui/data-table/data-table';
import { RowActions } from '@/components/ui/data-table/row-actions';
import { ColumnDef, FilterState } from '@/components/ui/data-table/data-table-types';
import { Badge } from '@/components/ui/badge';
import { isDateInFilter } from "@/lib/date-filters";
import {
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { PageLayout, PageHeader, PageToolbar, BulkActionBar, ConfirmDialog } from '@/components/shared';
import { MapPin } from 'lucide-react';
import {
  PointMapDialog,
  formatLatLng,
  hasPoint,
  type MapPoint,
} from '@/components/location-tracking/point-map-dialog';
import { PERMISSIONS } from '@/lib/auth/permissions-registry';

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
  const { accountId, isModuleEnabled, hasPermission, defaultCurrency, hasSFA } = useAuth();
  const territoryEnabled = isModuleEnabled('territory');

  const [contacts, setContacts] = useState<ContactWithData[]>([]);
  // When on, the list also loads soft-deleted (Inactive) customers so they can
  // be reviewed and re-activated.
  const [showInactive, setShowInactive] = useState(false);
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
    let contactsQuery = supabase.from('contacts').select('*').order('created_at', { ascending: false });
    // Default view hides soft-deleted customers; the "Show Inactive" toggle loads them too.
    if (!showInactive) contactsQuery = contactsQuery.eq('is_active', true);
    const [{ data: contactsData }, { data: tagsData }, { data: fieldsData }] = await Promise.all([
      contactsQuery,
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
  }, [supabase, accountId, showInactive]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);
  useRealtimeRefresh('contacts', fetchData);

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

    // Soft delete: mark Inactive rather than hard-delete, so it can be re-activated.
    const { error } = await supabase
      .from('contacts')
      .update({ is_active: false })
      .eq('id', deleteTarget.id);

    if (error) {
      toast.error('Failed to deactivate customer');
    } else {
      toast.success('Customer moved to Inactive');
      fetchData();
    }

    setDeleting(false);
    setDeleteConfirmOpen(false);
    setDeleteTarget(null);
  }

  async function handleReactivate(contact: Contact) {
    const { error } = await supabase
      .from('contacts')
      .update({ is_active: true })
      .eq('id', contact.id);
    if (error) {
      toast.error('Failed to re-activate customer');
    } else {
      toast.success('Customer re-activated');
      fetchData();
    }
  }

  async function handleBulkDelete() {
    const ids = Array.from(selectedContacts);
    if (ids.length === 0) return;
    setDeleting(true);

    const { error } = await supabase.from('contacts').update({ is_active: false }).in('id', ids);

    if (error) {
      toast.error('Failed to deactivate customers');
    } else {
      toast.success(`${ids.length} customer${ids.length === 1 ? '' : 's'} moved to Inactive`);
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
      // Shown by default: FMCG list scans as "Company → Contact Person".
      visibleByDefault: true,
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
      id: "status",
      label: "Status",
      type: "select",
      visibleByDefault: true,
      options: [
        { label: "Active", value: "active" },
        { label: "Inactive", value: "inactive" },
      ],
      render: (contact) => {
        const active = (contact as any).is_active !== false;
        return (
          <Badge className={active
            ? 'bg-emerald-600 text-white shadow-sm border-transparent text-[10px] px-1.5 font-semibold'
            : 'bg-muted text-muted-foreground border-border text-[10px] px-1.5 font-semibold'}>
            {active ? 'Active' : 'Inactive'}
          </Badge>
        );
      }
    },
    {
      id: "actions",
      label: "Action",
      visibleByDefault: true,
      render: (contact) => {
        const inactive = (contact as any).is_active === false;
        return (
          <RowActions
            isInactive={inactive}
            onEdit={() => openEditForm(contact)}
            onDelete={() => confirmDelete(contact)}
            onReactivate={() => handleReactivate(contact)}
            deleteTitle="Move to Inactive"
          />
        );
      }
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

  // Financial columns are SFA-line only (credit / opening balance / outstanding).
  if (hasSFA && isModuleEnabled('payment')) {
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
      }
    );
    
    if (hasPermission(PERMISSIONS.CUSTOMERS.VIEW_OUTSTANDING)) {
      columns.splice(columns.length - 1, 0, {
        id: "outstanding_amount",
        label: "Outstanding (Calculated)",
        type: "text",
        visibleByDefault: false,
        render: (contact) => {
          const val = (contact as any).outstanding_amount ?? (contact as any).opening_balance;
          if (val == null) return <span className="text-muted-foreground">-</span>;
          // Uses the shared formatter — this column previously rendered a raw number
          // ("10000") in the one place a rep scans to see who owes money.
          return (
            <span className="text-sm font-medium text-amber-600 dark:text-amber-500">
              {formatCurrency(Number(val), defaultCurrency)}
            </span>
          );
        }
      });
    }
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
        } else if (colId === "territory") {
          // Territory is a lookup column: its displayed value lives on _territoryName
          // (resolved from territory_id), not a plain contact field — filter on that.
          const territoryName = (contact as { _territoryName?: string | null })._territoryName;
          if (!territoryName?.toLowerCase().includes((val as string).toLowerCase())) return false;
        } else if (colId === "created_at") {
          if (!isDateInFilter(contact.created_at, val as string | string[])) return false;
        } else if (colId === "status") {
          const want = val as string[];
          if (Array.isArray(want) && want.length) {
            const state = (contact as any).is_active !== false ? "active" : "inactive";
            if (!want.includes(state)) return false;
          }
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
            label: "Move to Inactive",
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
        menuActions={
          <DropdownMenuItem onClick={() => setShowInactive((v) => !v)} className="cursor-pointer gap-2">
            {showInactive ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
            {showInactive ? 'Hide Inactive' : 'Show Inactive'}
          </DropdownMenuItem>
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
      <ImportWizard open={importOpen} onOpenChange={setImportOpen} module="contacts" onImported={fetchData} />

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Move Customer to Inactive"
        description={
          <>
            Move <span className="font-medium text-foreground">{deleteTarget?.company || deleteTarget?.name || deleteTarget?.phone}</span> to Inactive? It will be hidden from the default list but you can re-activate it anytime via “Show Inactive”.
          </>
        }
        variant="danger"
        confirmLabel="Move to Inactive"
        loading={deleting}
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title={`Move ${selectedContacts.size} Customers to Inactive`}
        description={`Move ${selectedContacts.size} customer${selectedContacts.size === 1 ? '' : 's'} to Inactive? They can be re-activated anytime via “Show Inactive”.`}
        variant="danger"
        confirmLabel="Move to Inactive"
        loading={deleting}
        onConfirm={handleBulkDelete}
      />

      <PointMapDialog point={mapPoint} onClose={() => setMapPoint(null)} />
    </PageLayout>
  );
}
