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
  RotateCcw,
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
import { useTableView } from '@/hooks/use-table-view';
import { useServerTable } from '@/hooks/use-server-table';
import { fetchAllPages } from '@/lib/table/export-all-pages';
import type { ServerTableQuery } from '@/lib/table/server-query';
import { applyCustomFieldFilters, customFieldFilterKey, applyDateFilter, applyInFilter, applyTextFilter, applyExtraColumnFilters, applyRangeFilter, applyAssignedEmployeeFilter, type AssignmentScope } from '@/lib/table/apply-filters';
import { RowActions } from '@/components/ui/data-table/row-actions';
import { ColumnDef, FilterState } from '@/components/ui/data-table/data-table-types';
import { Badge } from '@/components/ui/badge';
import { isDateInFilter } from "@/lib/date-filters";
import {
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { PageLayout, PageHeader, BulkActionBar, ConfirmDialog } from '@/components/shared';
import { MapPin } from 'lucide-react';
import {
  PointMapDialog,
  formatLatLng,
  hasPoint,
  type MapPoint,
} from '@/components/location-tracking/point-map-dialog';
import {
  PointsMapDialog,
  type PointsMapSelection,
} from '@/components/location-tracking/points-map-dialog';
import { splitMappableSelection, type GeoTaggedRow } from '@/lib/maps/selection-points';
import {
  inactiveSelection,
  reactivateDisabledReason,
  bulkReactivate,
  reactivatedMessage,
} from '@/lib/table/bulk-activation';
import { PERMISSIONS } from '@/lib/auth/permissions-registry';
import { extraColumns, type ExtraColumnSpec } from '@/lib/table/extra-columns';

interface ContactWithData extends Contact {
  tags?: Tag[];
  [key: string]: any;
}

/** Stored contacts fields with no hand-written column, shown via Manage Column. */
const CONTACT_EXTRA_COLUMNS: readonly ExtraColumnSpec<ContactWithData>[] = [
      ["whatsapp", "WhatsApp Number", "text"],
      ["gst_number", "GST Number", "text"],
      ["customer_code", "Customer Code", "text"],
];

export default function ContactsPage() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const canEdit = useCan('send-messages');
  const canEditSettings = useCan('edit-settings');
  const { accountId, isModuleEnabled, hasPermission, defaultCurrency, hasSFA } = useAuth();
  const territoryEnabled = isModuleEnabled('territory');

  const [hierarchy, setHierarchy] = useState<{ enabled: boolean; levels: { position: number; name: string; color?: string }[] }>({ enabled: false, levels: [] });
  
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
  // Default filter: show Active customers only (Inactive/all via the Status column filter).
  // _v3: saved column layouts would otherwise hide the new geo-tag columns.
  const tableView = useTableView("wacrm_contacts_table_columns_v3", { status: ['active'] });
  const { filterState } = tableView;
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(new Set());
  const [mapPoint, setMapPoint] = useState<MapPoint | null>(null);
  const [mapSelection, setMapSelection] = useState<PointsMapSelection | null>(null);

  // Lookups
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);

  /**
   * Reference data: tags, custom fields, people, area assignments and the
   * territory tree. All small, fixed-size lookups — loaded once per account
   * rather than alongside every page of customers.
   */
  const [refData, setRefData] = useState<{
    nameOf: (id: string | null | undefined) => string | null;
    areaEmployeesFor: (territoryId: string | null | undefined) => string[];
    /**
     * What one chosen person's claim on a customer looks like, for the
     * Assigned Employee filter. Resolved here because only here is the
     * territory tree walked.
     */
    assignmentScopeFor: (profileId: string) => AssignmentScope;
    /** Every territory that resolves to somebody at all. */
    coveredTerritoryIds: string[];
    tagsMap: Record<string, Tag>;
  }>({
    nameOf: () => null,
    areaEmployeesFor: () => [],
    assignmentScopeFor: () => ({ employeeIds: [], areaTerritoryIds: [], creatorIds: [] }),
    coveredTerritoryIds: [],
    tagsMap: {},
  });

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [{ data: tagsData }, { data: fieldsData }, { data: profilesData }, { data: areaData }, { data: allTerritories }] =
        await Promise.all([
          supabase.from('tags').select('*').order('name'),
          supabase.from('custom_fields').select('*').eq('module_name', 'contact'),
          supabase.from('profiles').select('id, user_id, full_name'),
          supabase.from('employee_area_assignments').select('employee_id, territory_id'),
          supabase.from('territories').select('id, parent_id').is('deleted_at', null),
        ]);
      if (!alive) return;

      setAllTags(tagsData || []);
      setCustomFields(fieldsData || []);

      // An employee id may be a profiles.id OR an auth user id — the app stores
      // both in different places — so resolve against either.
      const nameOf = (id: string | null | undefined): string | null => {
        if (!id) return null;
        const pr = (profilesData || []).find(
          (x: { id: string; user_id: string }) => x.id === id || x.user_id === id,
        );
        return (pr as { full_name?: string } | undefined)?.full_name ?? null;
      };

      const areaNamesByTerritory: Record<string, string[]> = {};
      (areaData || []).forEach((a: { employee_id: string; territory_id: string }) => {
        const nm = nameOf(a.employee_id);
        if (a.territory_id && nm) (areaNamesByTerritory[a.territory_id] ||= []).push(nm);
      });

      // An assignment on a parent territory (a State) covers customers tagged to
      // its children (a City/Area), so walk up to the first assigned ancestor.
      const territoryParent: Record<string, string | null> = {};
      (allTerritories || []).forEach((t: { id: string; parent_id: string | null }) => {
        territoryParent[t.id] = t.parent_id ?? null;
      });
      const areaEmployeesFor = (territoryId: string | null | undefined): string[] => {
        let cur = territoryId ?? null;
        let guard = 0;
        while (cur && guard < 8) {
          if (areaNamesByTerritory[cur]?.length) return areaNamesByTerritory[cur];
          cur = territoryParent[cur] ?? null;
          guard += 1;
        }
        return [];
      };

      const tagsMap: Record<string, Tag> = {};
      tagsData?.forEach((t: Tag) => {
        tagsMap[t.id] = t;
      });

      /**
       * The same walk the column does, but by id rather than by name, and
       * evaluated over every territory once so the filter can ask the
       * database a plain question.
       */
      const areaIdsByTerritory: Record<string, string[]> = {};
      (areaData || []).forEach((a: { employee_id: string; territory_id: string }) => {
        if (a.territory_id) (areaIdsByTerritory[a.territory_id] ||= []).push(a.employee_id);
      });
      const areaEmployeeIdsFor = (territoryId: string | null): string[] => {
        let cur = territoryId;
        let guard = 0;
        while (cur && guard < 8) {
          if (areaIdsByTerritory[cur]?.length) return areaIdsByTerritory[cur];
          cur = territoryParent[cur] ?? null;
          guard += 1;
        }
        return [];
      };

      const resolvedByTerritory = new Map<string, string[]>();
      (allTerritories || []).forEach((t: { id: string }) => {
        const owners = areaEmployeeIdsFor(t.id);
        if (owners.length) resolvedByTerritory.set(t.id, owners);
      });
      const coveredTerritoryIds = [...resolvedByTerritory.keys()];

      const assignmentScopeFor = (profileId: string): AssignmentScope => {
        // An employee id is stored as a profiles.id in some places and an auth
        // id in others, so a claim is made under either — the same reason
        // `nameOf` matches on both.
        const person = (profilesData || []).find(
          (x: { id: string; user_id: string }) => x.id === profileId || x.user_id === profileId,
        ) as { id: string; user_id: string } | undefined;
        const ids = [person?.id, person?.user_id].filter(Boolean) as string[];
        const areaTerritoryIds = [...resolvedByTerritory.entries()]
          .filter(([, owners]) => owners.some((o) => ids.includes(o)))
          .map(([territoryId]) => territoryId);
        return { employeeIds: ids, areaTerritoryIds, creatorIds: ids };
      };

      setRefData({
        nameOf,
        areaEmployeesFor,
        assignmentScopeFor,
        coveredTerritoryIds,
        tagsMap,
      });
    })();
    return () => {
      alive = false;
    };
  }, [supabase]);

  useEffect(() => {
    if (!accountId) return;
    let alive = true;
    void (async () => {
      const { data: acct } = await supabase.from('accounts').select('settings').eq('id', accountId).single();
      if (!alive) return;
      const os = acct?.settings?.order_settings;
      setHierarchy({ enabled: !!os?.hierarchy_enabled, levels: Array.isArray(os?.levels) ? os.levels : [] });
    })();
    return () => {
      alive = false;
    };
  }, [supabase, accountId]);

  /**
   * One page of customers, searched and filtered by the database.
   *
   * search_text covers company, contact person, phone, email and searchable
   * custom values; territory_name and custom_values are columns on the row
   * (migrations 20261012120000 / 20261012130000).
   */
  const buildQuery = useCallback<ServerTableQuery<Record<string, unknown>>>(
    (sb, { search, filters, from, to }) => {
      let q = sb.from('contacts').select('*', { count: 'exact' });

      if (search) q = q.ilike('search_text', `%${search.toLowerCase()}%`);

      // The "Company Name" column filters on company; "Contact Person" on name.
      // Company is a value list now, so it matches exactly rather than partly.
      q = applyInFilter(q, 'company', filters.name);
      q = applyTextFilter(q, 'name', filters.contact_person);
      q = applyTextFilter(q, 'phone', filters.phone);
      q = applyTextFilter(q, 'email', filters.email);
      // Columns the filter row offers as a value list match exactly; the rest
      // are still typed, so they stay a contains match.
      for (const col of ['area', 'city', 'state', 'country']) {
        q = applyInFilter(q, col, filters[col]);
      }
      for (const col of ['address', 'pincode']) {
        q = applyTextFilter(q, col, filters[col]);
      }
      q = applyInFilter(q, 'hierarchy_level', filters.hierarchy_level);

      // Assigned Employee. The column is a three-way fallback, so the filter
      // asks the same question in branches rather than comparing one column.
      const chosen = filters.assigned_employee;
      if (Array.isArray(chosen) && chosen.length) {
        q = applyAssignedEmployeeFilter(
          q,
          (chosen as string[]).map((id) => refData.assignmentScopeFor(id)),
          refData.coveredTerritoryIds,
        );
      }
      q = applyRangeFilter(q, 'credit_limit', filters.credit_limit);
      q = applyRangeFilter(q, 'credit_days', filters.credit_days);
      q = applyRangeFilter(q, 'opening_balance', filters.opening_balance);
      q = applyRangeFilter(q, 'outstanding_amount', filters.outstanding_amount);
      q = applyTextFilter(q, 'territory_name', filters.territory);
      q = applyDateFilter(q, 'created_at', filters.created_at);
      q = applyCustomFieldFilters(q, filters, customFields);

      const want = filters.status as string[] | undefined;
      if (Array.isArray(want) && want.length === 1) q = q.eq('is_active', want[0] === 'active');

      // The columns Manage Column offers for the rest of the stored fields.

      q = applyExtraColumnFilters(q, filters, CONTACT_EXTRA_COLUMNS);

      return q.order('created_at', { ascending: false }).range(from, to) as unknown as ReturnType<
        ServerTableQuery<Record<string, unknown>>
      >;
    },
    // `refData` matters: the Assigned Employee filter resolves through it, and
    // a stale copy would quietly add no condition at all.
    [customFields, refData],
  );

  /** Stable dep: only changes when an ACTIVE cf_* filter's type could change the query. */
  const cfKey = customFieldFilterKey(filterState, customFields);

  const table = useServerTable<Record<string, unknown>>({
    tableView,
    buildQuery,
    deps: [cfKey],
  });

  const fetchData = table.reload;
  const loading = table.loading;

  /** Tags for the rows on screen only, not for every customer in the account. */
  const [tagsByContact, setTagsByContact] = useState<Record<string, Tag[]>>({});
  const pageIds = useMemo(() => table.rows.map((c) => String(c.id)).join(','), [table.rows]);
  useEffect(() => {
    if (!pageIds) {
      setTagsByContact({});
      return;
    }
    let alive = true;
    void (async () => {
      const { data } = await supabase
        .from('contact_tags')
        .select('contact_id, tag_id')
        .in('contact_id', pageIds.split(','));
      if (!alive) return;
      const byContact: Record<string, Tag[]> = {};
      (data || []).forEach((ct: { contact_id: string; tag_id: string }) => {
        const tag = refData.tagsMap[ct.tag_id];
        if (tag) (byContact[ct.contact_id] ||= []).push(tag);
      });
      setTagsByContact(byContact);
    })();
    return () => {
      alive = false;
    };
  }, [pageIds, supabase, refData.tagsMap]);

  const contacts = useMemo(
    () =>
      table.rows.map((row) => {
        const c = row as Record<string, any>;
        // Assigned Employee = direct assignment, else area-wise (via territory),
        // else the salesman who created the customer.
        const areaNames = refData.areaEmployeesFor(c.territory_id);
        return {
          ...c,
          ...(c.custom_values ?? {}),
          tags: tagsByContact[c.id] || [],
          _territoryName: c.territory_name ?? null,
          _assignedEmployee:
            refData.nameOf(c.employee_id) ||
            (areaNames.length > 0 ? areaNames.join(', ') : null) ||
            refData.nameOf(c.user_id) ||
            null,
        };
      }),
    [table.rows, tagsByContact, refData],
  );

  const exportAll = useCallback(async () => {
    const { rows, truncated } = await fetchAllPages(supabase, buildQuery, {
      search: table.search.trim(),
      filters: filterState,
    });
    return {
      rows: rows.map((r) => {
        const c = r as Record<string, any>;
        return { ...c, ...(c.custom_values ?? {}), _territoryName: c.territory_name ?? null };
      }),
      truncated,
    };
  }, [supabase, buildQuery, table.search, filterState]);

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

  /**
   * Restore every selected customer that is currently Inactive.
   *
   * Not confirmed: re-activating is not destructive, and an admin who picked
   * the rows and pressed the button has already said what they want. The button
   * itself is disabled unless the selection actually holds something Inactive.
   */
  async function handleBulkReactivate() {
    const ids = inactiveSelection(contacts, selectedContacts);
    if (ids.length === 0) return;
    setDeleting(true);

    const { error } = await bulkReactivate(supabase, 'contacts', ids);

    if (error) {
      toast.error('Failed to re-activate customers');
    } else {
      toast.success(reactivatedMessage(ids.length, 'customer'));
      setSelectedContacts(new Set());
      fetchData();
    }

    setDeleting(false);
  }

  /** Plot every selected customer that has a saved coordinate on one map. */
  function handleShowSelectionOnMap() {
    const { points, skipped } = splitMappableSelection(contacts, selectedContacts, {
      titleOf: (c) => c.company || c.name || c.phone,
      latOf: (c) => (c as GeoTaggedRow).latitude,
      lngOf: (c) => (c as GeoTaggedRow).longitude,
    });
    if (points.length === 0) {
      toast.error('None of the selected customers have a saved location');
      return;
    }
    setMapSelection({
      title: `${points.length} ${points.length === 1 ? 'Customer' : 'Customers'} on map`,
      points,
      skipped,
    });
  }

  const columns: ColumnDef<ContactWithData>[] = [
    {
      // The id stays "name" so saved column preferences keep working, but the
      // column renders `contact.company`, so its heading and visibility are
      // governed by the 'company' field — not by 'name', which is the contact
      // person. Without systemKey this heading read "Contact Person".
      id: "name",
      systemKey: "company",
      label: "Company Name",
      type: "select",
      valueSource: { kind: "distinct", module: "contact", column: "company" },
      render: (contact) => (
        <span className="font-medium">{contact.company || contact.name || <span className="text-muted-foreground italic">Unnamed</span>}</span>
      )
    },
    {
      id: "contact_person",
      systemKey: "name",
      label: "Contact Person",
      type: "text",
      // Shown by default: FMCG list scans as "Company → Contact Person".
      visibleByDefault: true,
      render: (contact) => <span>{contact.name || "-"}</span>
    },
    {
      id: "assigned_employee",
      label: "Assigned Employee",
      type: "select",
      valueSource: { kind: "people", idSpace: "profile" },
      // Visible by default; admins can hide it via Manage Columns.
      visibleByDefault: true,
      render: (contact) => {
        const emp = (contact as any)._assignedEmployee;
        return emp ? <span>{emp}</span> : <span className="text-muted-foreground">Unassigned</span>;
      }
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
      // No filter yet — see Phase 2. A control that does nothing is worse
      // than none now that the filter row is always visible.
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
      type: "select",
      valueSource: { kind: "distinct", module: "contact", column: "area" },
      visibleByDefault: false,
      render: (contact) => <span className="text-sm">{contact.area || "-"}</span>
    },
    {
      id: "city",
      label: "City",
      type: "select",
      valueSource: { kind: "distinct", module: "contact", column: "city" },
      visibleByDefault: false,
      render: (contact) => <span className="text-sm">{contact.city || "-"}</span>
    },
    {
      id: "state",
      label: "State",
      type: "select",
      valueSource: { kind: "distinct", module: "contact", column: "state" },
      visibleByDefault: false,
      render: (contact) => <span className="text-sm">{contact.state || "-"}</span>
    },
    {
      id: "country",
      label: "Country",
      type: "select",
      valueSource: { kind: "distinct", module: "contact", column: "country" },
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
      // No filter yet — see Phase 2. A control that does nothing is worse
      // than none now that the filter row is always visible.
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
    },
    // The rest of what a customer stores, so Manage Column can offer it.
    ...extraColumns<ContactWithData>(CONTACT_EXTRA_COLUMNS),
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
        type: "range",
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
        type: "range",
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
        type: "range",
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
        type: "range",
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

  /** buildQuery already applied the search and every column filter. */
  const filteredContacts = contacts;

  // Which bulk actions can actually run against this selection. Both are
  // derived rather than stored so they cannot drift from the selection.
  const inactiveSelectedIds = useMemo(
    () => inactiveSelection(contacts, selectedContacts),
    [contacts, selectedContacts],
  );
  const mappableSelectedCount = useMemo(
    () =>
      splitMappableSelection(contacts, selectedContacts, {
        titleOf: (c) => c.company || c.name || c.phone,
        latOf: (c) => (c as GeoTaggedRow).latitude,
        lngOf: (c) => (c as GeoTaggedRow).longitude,
      }).points.length,
    [contacts, selectedContacts],
  );

  return (
    <PageLayout fill>
      {/* No actions of its own: it is here to host the table's
          controls, which used to sit on a line of their own. */}
      <PageHeader title="Customers" />
      <BulkActionBar
        selectedCount={selectedContacts.size}
        onClear={() => setSelectedContacts(new Set())}
        actions={[
          {
            label: "Show on Map",
            icon: <MapPin className="size-3.5" />,
            variant: "outline",
            onClick: handleShowSelectionOnMap,
            disabled: mappableSelectedCount === 0,
            title: mappableSelectedCount === 0
              ? "None of the selected customers have a saved location"
              : undefined,
          },
          {
            label: "Re-activate",
            icon: <RotateCcw className="size-3.5" />,
            variant: "outline",
            onClick: handleBulkReactivate,
            disabled: deleting || inactiveSelectedIds.length === 0,
            title: reactivateDisabledReason(selectedContacts.size, inactiveSelectedIds.length),
          },
          {
            label: "Move to Inactive",
            icon: <Trash2 className="size-3.5" />,
            variant: "destructive",
            onClick: () => setBulkDeleteOpen(true),
          },
        ]}
      />

      <DataTable
        fill
        search={{
          value: table.search,
          onChange: table.setSearch,
          placeholder: "Search customers by company, person, phone or email...",
        }}
        columns={visibleColumns}
        data={filteredContacts}
        unseenModule="contact"
        createdAtOf={(contact) => contact.created_at as string | undefined}
        serverPagination={{ ...table.serverPagination, exportAll }}
        actions={
          <div className="flex items-center gap-2">
            <GatedButton data-tour="customer-import" variant="outline" size="sm" canAct={canEdit} gateReason="add or import contacts" onClick={() => setImportOpen(true)} className="h-7 text-xs px-2.5">
              <Upload className="size-3 mr-1" /> Import
            </GatedButton>
            <GatedButton data-tour="customer-add" size="sm" canAct={canEdit} gateReason="add or import contacts" onClick={openAddForm} className="h-7 text-xs px-2.5 bg-primary hover:bg-primary/90 text-primary-foreground">
              <Plus className="size-3 mr-1" /> Add Customer
            </GatedButton>
          </div>
        }
        tableView={tableView}
        isLoading={loading}
        rowKey={(contact) => contact.id}
        rowHref={(contact) => `/contacts/${contact.id}`}
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
      <PointsMapDialog selection={mapSelection} onClose={() => setMapSelection(null)} />
    </PageLayout>
  );
}
