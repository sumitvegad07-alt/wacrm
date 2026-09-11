"use client";

// Catalog → Unit. Units of measure for products, moved out of Catalogue Settings
// into its own Catalog page. UI relocation only — same component and behaviour.
import { PageLayout, PageHeader } from "@/components/shared";
import { ProductUnitsSettings } from "@/components/settings/product-units-settings";

export default function CatalogUnitsPage() {
  return (
    <PageLayout>
      <PageHeader
        title="Units"
        subtitle="Units of measure for your products (e.g. Pcs, Box, Kg) and their conversions."
      />
      <ProductUnitsSettings />
    </PageLayout>
  );
}
