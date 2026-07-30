"use client";

import { ContactForm } from "@/components/contacts/contact-form";
import { useRouter } from "next/navigation";

export default function NewContactPage() {
  const router = useRouter();

  return (
    <ContactForm
      open={true}
      onOpenChange={(open) => {
        if (!open) router.push("/contacts");
      }}
      onSaved={() => {
        router.push("/contacts");
      }}
      asPage={true}
    />
  );
}
