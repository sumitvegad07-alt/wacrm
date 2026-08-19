"use client";

import { useRouter } from "next/navigation";
import { SchemeForm } from "@/components/schemes/scheme-form";

export default function NewSchemePage() {
  const router = useRouter();
  return (
    <SchemeForm
      asPage
      onClose={() => router.push("/schemes")}
      onSaved={() => router.push("/schemes")}
    />
  );
}
