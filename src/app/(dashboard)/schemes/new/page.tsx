"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { SchemeForm } from "@/components/schemes/scheme-form";

export default function NewSchemePage() {
  const router = useRouter();
  const params = useSearchParams();
  const cloneFromId = params.get("from") ?? undefined;
  return (
    <SchemeForm
      asPage
      cloneFromId={cloneFromId}
      onClose={() => router.push("/schemes")}
      onSaved={() => router.push("/schemes")}
    />
  );
}
