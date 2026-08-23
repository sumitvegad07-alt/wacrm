"use client";

import { ProductForm } from "@/components/products/product-form";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";

export default function NewProductPage() {
  const router = useRouter();
  // Catalogue create is admin-only at the DB layer (Hardening Sprint 1).
  // Block non-admins from the create page so they never hit a silent RLS failure.
  const { isOwner, isAdmin, loading } = useAuth();
  const canManageCatalogue = isOwner || isAdmin;

  useEffect(() => {
    if (!loading && !canManageCatalogue) router.replace("/products");
  }, [loading, canManageCatalogue, router]);

  if (!loading && !canManageCatalogue) return null;

  return (
    <ProductForm
      open={true}
      onOpenChange={(open) => {
        if (!open) router.push("/products");
      }}
      onSaved={() => {
        router.push("/products");
      }}
      asPage={true}
    />
  );
}
