"use client";

import { ProductForm } from "@/components/products/product-form";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";

export default function NewProductPage() {
  const router = useRouter();
  // Catalogue create is per-key at the DB layer (Module-wise RBAC v1: create_products).
  // Block users without the right from the create page so they never hit a silent RLS failure.
  const { hasPermission, loading } = useAuth();
  const canCreateProducts = hasPermission("create_products");

  useEffect(() => {
    if (!loading && !canCreateProducts) router.replace("/products");
  }, [loading, canCreateProducts, router]);

  if (!loading && !canCreateProducts) return null;

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
