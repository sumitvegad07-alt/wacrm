"use client";

import { QuotationForm } from "@/components/quotations/quotation-form";
import { useRouter } from "next/navigation";

export default function NewQuotationPage() {
  const router = useRouter();

  return (
    <QuotationForm
      open={true}
      onOpenChange={(open) => {
        if (!open) router.push("/quotations");
      }}
      onSaved={() => {
        router.push("/quotations");
      }}
      asPage={true}
    />
  );
}
