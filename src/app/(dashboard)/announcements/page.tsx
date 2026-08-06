"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Plus, Search, Megaphone, CheckCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PageLayout, PageHeader, PageToolbar } from "@/components/shared";
import { DataTable } from "@/components/ui/data-table/data-table";
import { ColumnDef } from "@/components/ui/data-table/data-table-types";

export default function AnnouncementsPage() {
  const { accountId, accountRole } = useAuth();
  const router = useRouter();
  const supabase = createClient();
  
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [globalSearch, setGlobalSearch] = useState("");
  
  const isAdmin = accountRole === 'admin' || accountRole === 'owner';

  async function loadAnnouncements() {
    if (!accountId) return;
    setLoading(true);
    
    const query = supabase
      .from("tenant_announcements")
      .select("*")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false });
      
    const { data, error } = await query;
    
    if (error) {
      toast.error("Failed to load announcements");
    } else {
      setAnnouncements(data || []);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadAnnouncements();
  }, [accountId]);

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this announcement?")) return;
    const { error } = await supabase.from("tenant_announcements").delete().eq("id", id);
    if (error) {
      toast.error("Failed to delete announcement");
    } else {
      toast.success("Announcement deleted successfully");
      loadAnnouncements();
    }
  };

  const columns: ColumnDef<any>[] = useMemo(() => {
    const cols: ColumnDef<any>[] = [
      {
        id: "title",
        label: "Title",
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
        render: (row) => {
          const hasUsers = row.employee_ids && row.employee_ids.length > 0;
          const hasRoles = row.employee_role_ids && row.employee_role_ids.length > 0;
          if (hasUsers && hasRoles) return <Badge variant="outline">Specific Users & Roles</Badge>;
          if (hasUsers) return <Badge variant="outline">Specific Users</Badge>;
          if (hasRoles) return <Badge variant="outline">Specific Roles</Badge>;
          return <Badge variant="secondary">All Users</Badge>;
        }
      },
      {
        id: "expiry_date",
        label: "Expiry Date",
        render: (row) => {
          const val = row.expiry_date;
          if (!val) return <span className="text-muted-foreground">Never</span>;
          const isExpired = new Date(val) < new Date();
          return (
            <div className="flex items-center gap-2">
              <span>{format(new Date(val), "dd MMM yyyy")}</span>
              {isExpired && <Badge variant="destructive" className="text-[10px] h-4">Expired</Badge>}
            </div>
          );
        }
      },

      {
        id: "created_at",
        label: "Created On",
        render: (row) => format(new Date(row.created_at), "dd MMM yyyy HH:mm")
      }
    ];

    if (isAdmin) {
      cols.push({
        id: "actions",
        label: "Actions",
        render: (row) => (
          <Button variant="ghost" size="sm" onClick={() => handleDelete(row.id)} className="text-destructive hover:text-destructive hover:bg-destructive/10">
            Delete
          </Button>
        )
      });
    }

    return cols;
  }, [isAdmin]);

  const filteredData = useMemo(() => {
    return announcements.filter(item => 
      item.title?.toLowerCase().includes(globalSearch.toLowerCase()) ||
      item.content?.toLowerCase().includes(globalSearch.toLowerCase())
    );
  }, [announcements, globalSearch]);

  return (
    <PageLayout>
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

      <PageToolbar>
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search announcements..."
            className="pl-8"
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
          />
        </div>
      </PageToolbar>

      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden mt-6">
        <DataTable
          columns={columns}
          data={filteredData}
          isLoading={loading}
          emptyMessage="No announcements found"
          storageKey="announcements-table"
          rowKey={(row) => row.id}
        />
      </div>
    </PageLayout>
  );
}
