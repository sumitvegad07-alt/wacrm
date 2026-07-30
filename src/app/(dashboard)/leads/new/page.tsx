"use client";

import { LeadForm } from "@/components/leads/lead-form";
import { useRouter } from "next/navigation";

export default function NewLeadPage() {
  const router = useRouter();

  return (
    <LeadForm
      open={true}
      onOpenChange={(open) => {
        if (!open) router.push("/leads");
      }}
      lead={null}
      onSaved={(savedId) => {
        router.push(savedId ? `/leads/${savedId}` : "/leads");
      }}
      asPage={true}
    />
  );
}
