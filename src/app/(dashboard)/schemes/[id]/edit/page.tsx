"use client";

import { useRouter } from "@/lib/navigation";
import { useParams } from "next/navigation";
import { SchemeForm } from "@/components/schemes/scheme-form";

export default function EditSchemePage() {
  const router = useRouter();
  const { id } = useParams() as { id: string };
  return (
    <SchemeForm
      asPage
      schemeId={id}
      onClose={() => router.push("/schemes")}
      onSaved={() => router.push("/schemes")}
    />
  );
}
