"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageLayout, PageHeader } from "@/components/shared";
import { AnnouncementForm } from "@/components/announcements/announcement-form";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function EditAnnouncementPage() {
  const params = useParams();
  const id = params.id as string;
  const supabase = createClient();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from("tenant_announcements")
        .select("*")
        .eq("id", id)
        .single();
      
      if (error) {
        toast.error("Failed to load announcement");
      } else {
        setData(data);
      }
      setLoading(false);
    }
    if (id) load();
  }, [id, supabase]);

  if (loading) {
    return (
      <PageLayout>
        <div className="flex h-[400px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </PageLayout>
    );
  }

  if (!data) {
    return (
      <PageLayout>
        <div className="flex h-[400px] flex-col items-center justify-center space-y-2">
          <p className="text-xl font-semibold">Announcement not found</p>
          <p className="text-sm text-muted-foreground">The announcement may have been deleted.</p>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <PageHeader
        title="Edit Announcement"
      >
        <p className="text-sm text-muted-foreground">Update the details of your announcement.</p>
      </PageHeader>
      <AnnouncementForm initialData={data} />
    </PageLayout>
  );
}
