"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Plus, Eye, EyeOff, Search, Link as LinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PageLayout, PageHeader } from "@/components/shared";
import { DataTable } from "@/components/ui/data-table/data-table";
import { useTableView } from "@/hooks/use-table-view";
import { RowActions } from "@/components/ui/data-table/row-actions";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { ColumnDef, FilterState } from "@/components/ui/data-table/data-table-types";
import { matchesColumnFilters } from "@/lib/table/match-filters";

/**
 * Who an announcement is aimed at, as one of four fixed wordings.
 *
 * Shared by the cell and its filter so the two cannot drift apart — the filter
 * offers exactly the labels the column shows.
 */
function targetAudience(row: { employee_ids?: unknown[] | null; employee_role_ids?: unknown[] | null }): string {
  const hasUsers = Boolean(row.employee_ids && row.employee_ids.length > 0);
  const hasRoles = Boolean(row.employee_role_ids && row.employee_role_ids.length > 0);
  if (hasUsers && hasRoles) return "Specific Users & Roles";
  if (hasUsers) return "Specific Users";
  if (hasRoles) return "Specific Roles";
  return "All Users";
}
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { REFERENCE_ROW_CAP } from "@/lib/table/reference-cap";

export default function AnnouncementsPage() {
  const { accountId, accountRole } = useAuth();
  const router = useRouter();
  const supabase = createClient();
  
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [globalSearch, setGlobalSearch] = useState("");
  // Default filter shows Active announcements (Inactive/all via the Status column filter).
  const tableView = useTableView("announcements-table", { record_status: ['active'] });
  const { filterState } = tableView;
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const isAdmin = accountRole === 'admin' || accountRole === 'owner';

  const loadAnnouncements = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);

    const { data, error } = await supabase
      .from("tenant_announcements")
      .select("*")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(REFERENCE_ROW_CAP);

    if (error) {
      toast.error("Failed to load announcements");
    } else {
      setAnnouncements(data || []);
    }
    setLoading(false);
  }, [accountId, supabase]);

  useEffect(() => {
    loadAnnouncements();
  }, [loadAnnouncements]);

  const confirmDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    const { error } = await supabase.from("tenant_announcements").update({ is_active: false }).eq("id", deleteId);
    setDeleting(false);
    if (error) {
      toast.error("Failed to deactivate announcement");
    } else {
      toast.success("Announcement moved to Inactive");
      setDeleteId(null);
      loadAnnouncements();
    }
  };

  const handleReactivate = async (id: string) => {
    const { error } = await supabase.from("tenant_announcements").update({ is_active: true }).eq("id", id);
    if (error) toast.error("Failed to re-activate announcement");
    else { toast.success("Announcement re-activated"); loadAnnouncements(); }
  };

  const columns: ColumnDef<any>[] = useMemo(() => {
    const cols: ColumnDef<any>[] = [
      {
        id: "title",
        label: "Title",
        type: "text",
        render: (row) => (
          <div className="flex flex-col">
            <span className="font-medium">{row.title}</span>
            <span className="text-xs text-muted-foreground truncate max-w-[300px]">
              {row.content?.replace(/<[^>]*>?/gm, '').substring(0, 50)}...
            </span>
          </div>
        )
      },
      {
        id: "target",
        label: "Target Audience",
        type: "select",
        options: [
          { label: "All Users", value: "All Users" },
          { label: "Specific Users", value: "Specific Users" },
          { label: "Specific Roles", value: "Specific Roles" },
          { label: "Specific Users & Roles", value: "Specific Users & Roles" },
        ],
        filterValue: (row) => targetAudience(row),
        render: (row) => {
          const label = targetAudience(row);
          return (
            <Badge variant={label === "All Users" ? "secondary" : "outline"}>{label}</Badge>
          );
        }
      },
      {
        id: "external_link",
        label: "Link",
        type: "text",
        render: (row) => row.external_link ? (
          <a 
            href={row.external_link} 
            target="_blank" 
            rel="noopener noreferrer" 
            className="text-primary hover:underline flex items-center gap-1 text-sm max-w-[200px]"
            onClick={(e) => e.stopPropagation()}
          >
            <LinkIcon className="h-3 w-3 shrink-0" />
            <span className="truncate">{row.external_link.replace(/^https?:\/\//, '')}</span>
          </a>
        ) : <span className="text-muted-foreground">-</span>
      },
      {
        id: "created_at",
        label: "Created On",
        type: "date",
        render: (row) => <span className="text-sm text-muted-foreground">{new Date(row.created_at).toLocaleDateString('en-IN')}</span>
      },
      {
        id: "expiry_date",
        label: "Expiry Date",
        type: "date",
        render: (row) => {
          const val = row.expiry_date;
          if (!val) return <span className="text-muted-foreground">Never</span>;
          const isExpired = new Date(val) < new Date();
          return (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{new Date(val).toLocaleDateString('en-IN')}</span>
              {isExpired && <Badge variant="destructive" className="text-[10px] h-4">Expired</Badge>}
            </div>
          );
        }
      },
      {
        id: "record_status",
        label: "Status",
        type: "select",
        visibleByDefault: true,
        options: [ { label: "Active", value: "active" }, { label: "Inactive", value: "inactive" } ],
        // Soft-delete state lives in is_active, not in a record_status field.
        filterValue: (row) => (row.is_active !== false ? "active" : "inactive"),
        render: (row) => {
          const active = row.is_active !== false;
          return (
            <Badge className={active
              ? 'bg-emerald-600 text-white shadow-sm border-transparent text-[10px] px-1.5 font-semibold'
              : 'bg-muted text-muted-foreground border-border text-[10px] px-1.5 font-semibold'}>
              {active ? 'Active' : 'Inactive'}
            </Badge>
          );
        }
      }
    ];

    if (isAdmin) {
      cols.push({
        id: "actions",
        label: "Action",
        type: "text",
        render: (row) => (
          <RowActions
            isInactive={row.is_active === false}
            onEdit={() => router.push(`/announcements/${row.id}/edit`)}
            onDelete={() => setDeleteId(row.id)}
            onReactivate={() => handleReactivate(row.id)}
            deleteTitle="Move to Inactive"
          />
        )
      });
    }

    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, router]);

  const filteredData = useMemo(() => {
    return announcements.filter(item => {
      // Global Search
      if (globalSearch) {
        const q = globalSearch.toLowerCase();
        if (!item.title?.toLowerCase().includes(q) && !item.content?.toLowerCase().includes(q)) {
          return false;
        }
      }

      // Column filters, driven by the column definitions so a control can
      // never be offered for a column nobody wired. Target Audience and Link
      // were both in that state.
      if (!matchesColumnFilters(item, filterState, columns)) return false;

      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [announcements, globalSearch, filterState, columns]);

  return (
    <PageLayout fill>
      <PageHeader
        title="Announcements"
        actions={
          isAdmin ? (
            <Link href="/announcements/new">
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                Create Announcement
              </Button>
            </Link>
          ) : null
        }
      >
        <p className="text-sm text-muted-foreground">Broadcast important news and updates to your mobile team.</p>
      </PageHeader>

      <DataTable
        fill
        search={{
          value: globalSearch,
          onChange: setGlobalSearch,
          placeholder: "Search announcements...",
        }}
        columns={columns}
        data={filteredData}
        isLoading={loading}
        emptyMessage="No announcements found"
        tableView={tableView}
        rowKey={(row) => row.id}
        rowHref={(row) => `/announcements/${row.id}`}
      />

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(o) => { if (!o) setDeleteId(null); }}
        title="Move announcement to Inactive"
        description="Move this announcement to Inactive? It will be hidden from the default list but you can re-activate it anytime via “Show Inactive”."
        confirmLabel="Move to Inactive"
        variant="danger"
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </PageLayout>
  );
}
