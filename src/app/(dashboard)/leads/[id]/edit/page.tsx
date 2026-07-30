"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LeadForm } from "@/components/leads/lead-form";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Lead } from "@/types";

export default function EditLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const leadId = resolvedParams.id;
  const router = useRouter();
  const supabase = createClient();

  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchLead() {
      setLoading(true);
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .eq("id", leadId)
        .single();
      if (error || !data) {
        toast.error("Failed to load lead");
        router.push("/leads");
      } else {
        setLead(data as Lead);
      }
      setLoading(false);
    }
    fetchLead();
  }, [leadId]);

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!lead) return null;

  return (
    <LeadForm
      open={true}
      onOpenChange={(open) => {
        if (!open) router.push(`/leads/${leadId}`);
      }}
      lead={lead}
      onSaved={() => {
        router.push(`/leads/${leadId}`);
      }}
      asPage={true}
    />
  );
}
