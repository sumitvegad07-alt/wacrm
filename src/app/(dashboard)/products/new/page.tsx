"use client";

import { ProductForm } from "@/components/products/product-form";
import { useRouter } from "next/navigation";

export default function NewProductPage() {
  const router = useRouter();

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
