"use client";

// Catalog → Category. Product categories + the category-level naming config,
// moved out of Catalogue Settings into its own Catalog page. UI relocation only:
// it reuses the exact ProductCategoriesSettings component and persists the same
// product_settings the settings page did (levels count + level names). The
// category records themselves are saved immediately by the component's own CRUD.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { PageLayout, PageHeader } from "@/components/shared";
import { ProductCategoriesSettings } from "@/components/settings/product-categories-settings";

export default function CatalogCategoriesPage() {
  const supabase = createClient();
  const { accountId, canEditSettings } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const [levelsCount, setLevelsCount] = useState<1 | 2 | 3>(1);
  const [level1Name, setLevel1Name] = useState("Category");
  const [level2Name, setLevel2Name] = useState("Sub-Category");
  const [level3Name, setLevel3Name] = useState("Brand");

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const { data } = await supabase.from("accounts").select("settings").eq("id", accountId).single();
    const ps = data?.settings?.product_settings ?? {};
    setLevelsCount((ps.levels_count as 1 | 2 | 3) || 1);
    setLevel1Name(ps.level_1_name || "Category");
    setLevel2Name(ps.level_2_name || "Sub-Category");
    setLevel3Name(ps.level_3_name || "Brand");
    setHasChanges(false);
    setLoading(false);
  }, [accountId, supabase]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!accountId) return;
    setSaving(true);
    const { data: acct } = await supabase.from("accounts").select("settings").eq("id", accountId).single();
    const settings = acct?.settings ?? {};
    const { error } = await supabase
      .from("accounts")
      .update({
        settings: {
          ...settings,
          product_settings: {
            ...(settings.product_settings ?? {}),
            levels_count: levelsCount,
            level_1_name: level1Name,
            level_2_name: level2Name,
            level_3_name: level3Name,
          },
        },
      })
      .eq("id", accountId);
    setSaving(false);
    if (error) { toast.error("Could not save category settings"); return; }
    toast.success("Category settings saved");
    setHasChanges(false);
  }

  if (loading) {
    return (
      <PageLayout>
        <div className="p-10 flex items-center justify-center text-sm text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <PageHeader
        title="Categories"
        subtitle="Organise products into categories, with optional sub-levels."
        actions={canEditSettings ? (
          <Button onClick={save} disabled={!hasChanges || saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
            Save
          </Button>
        ) : undefined}
      />
      <ProductCategoriesSettings
        levelsCount={levelsCount}
        setLevelsCount={(v) => { setLevelsCount(v); setHasChanges(true); }}
        level1Name={level1Name}
        setLevel1Name={(v) => { setLevel1Name(v); setHasChanges(true); }}
        level2Name={level2Name}
        setLevel2Name={(v) => { setLevel2Name(v); setHasChanges(true); }}
        level3Name={level3Name}
        setLevel3Name={(v) => { setLevel3Name(v); setHasChanges(true); }}
      />
    </PageLayout>
  );
}
