"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save, Loader2, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  buildDefaultConfig,
  MODULE_CAPABILITIES,
  MODULE_LABELS,
  DOCUMENT_MODULES,
  ITEM_COLUMNS,
  TOTAL_ROWS,
  type DocumentModule,
  type DocumentTemplateConfig,
  type DocumentInfoRow,
  type ItemColumn,
  type PartyBlock,
} from "@/lib/document-templates/schema";
import {
  createTemplate,
  getTemplate,
  updateTemplate,
} from "@/lib/document-templates/repository";
import { DocumentTemplatePreview } from "./document-template-preview";

const PARTY_FIELDS: { key: keyof PartyBlock; label: string }[] = [
  { key: "code", label: "Code" },
  { key: "name", label: "Name" },
  { key: "address", label: "Address" },
  { key: "area", label: "Area" },
  { key: "city", label: "City" },
  { key: "statePin", label: "State / Pin" },
  { key: "contactDetails", label: "Contact Details" },
  { key: "gstDetails", label: "GST Details" },
];

const HEADER_FIELDS: { key: keyof DocumentTemplateConfig["header"]; label: string }[] = [
  { key: "orgLogo", label: "Company Logo" },
  { key: "orgName", label: "Company Name" },
  { key: "orgContact", label: "Contact Details" },
  { key: "orgAddress", label: "Address" },
  { key: "orgGst", label: "GST Number" },
];

interface CustomFieldOption {
  id: string;
  label: string;
}

function isDocumentModule(value: string | undefined): value is DocumentModule {
  return !!value && (DOCUMENT_MODULES as readonly string[]).includes(value);
}

export function DocumentTemplateEditor({
  templateId,
  moduleParam,
}: {
  templateId?: string;
  moduleParam?: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const { accountId, user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [manageFooterOpen, setManageFooterOpen] = useState(false);

  const [module, setModule] = useState<DocumentModule>(
    isDocumentModule(moduleParam) ? moduleParam : "order"
  );
  const [name, setName] = useState(templateId ? "" : "New Template");
  const [config, setConfig] = useState<DocumentTemplateConfig>(() =>
    buildDefaultConfig(isDocumentModule(moduleParam) ? moduleParam : "order")
  );
  const [customFields, setCustomFields] = useState<CustomFieldOption[]>([]);
  const [uploadingSignature, setUploadingSignature] = useState(false);

  const caps = MODULE_CAPABILITIES[module];

  const handleSignatureUpload = async (file: File) => {
    if (!accountId) return;
    // Mirrors the bucket's own limits so the failure is a sentence rather than a 413.
    if (file.size > 2 * 1024 * 1024) {
      toast.error("That image is over 2 MB. Please use a smaller one.");
      return;
    }

    setUploadingSignature(true);
    try {
      const ext = file.name.split(".").pop() || "png";
      // First path segment is the account id — the storage policy checks membership on it.
      const path = `${accountId}/signatures/${crypto.randomUUID()}.${ext}`;

      const { error } = await supabase.storage.from("document_assets").upload(path, file);
      if (error) throw error;

      const { data } = supabase.storage.from("document_assets").getPublicUrl(path);
      setBottom({
        signature: { ...config.bottomSections.signature, attachmentUrl: data.publicUrl },
      });
      toast.success("Signature image attached. Remember to save the template.");
    } catch (err: any) {
      toast.error(`Upload failed: ${err.message}`);
    } finally {
      setUploadingSignature(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Load
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      try {
        if (templateId) {
          const tpl = await getTemplate(supabase, templateId);
          if (!alive) return;
          if (!tpl) {
            toast.error("Template not found.");
            router.push("/settings?tab=document_templates");
            return;
          }
          setModule(tpl.moduleName);
          setName(tpl.name);
          setConfig(tpl.config);
        }
      } catch (err: any) {
        if (alive) toast.error(`Could not load template: ${err.message}`);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [templateId, supabase, router]);

  // The real custom-field catalogue for this module. The original mockup listed four
  // hardcoded strings ("Dispatch Through", "E-Way Bill", ...) that matched nothing.
  useEffect(() => {
    if (!accountId || !caps.customFields) {
      setCustomFields([]);
      return;
    }
    let alive = true;

    (async () => {
      const { data } = await supabase
        .from("custom_fields")
        .select("id, label, field_name")
        .eq("account_id", accountId)
        .eq("module_name", module)
        .eq("is_active", true)
        .order("label");

      if (!alive) return;
      setCustomFields(
        (data ?? []).map((f: any) => ({ id: f.id, label: f.label || f.field_name || "Untitled" }))
      );
    })();

    return () => {
      alive = false;
    };
  }, [accountId, module, caps.customFields, supabase]);

  // ---------------------------------------------------------------------------
  // Edit helpers — each returns a new config so the preview re-renders
  // ---------------------------------------------------------------------------
  const setHeader = (key: keyof DocumentTemplateConfig["header"], value: boolean) =>
    setConfig((c) => ({ ...c, header: { ...c.header, [key]: value } }));

  const setParty = (which: "shipTo" | "billTo", patch: Partial<PartyBlock>) =>
    setConfig((c) => ({
      ...c,
      documentInfo: {
        ...c.documentInfo,
        [which]: { ...c.documentInfo[which], ...patch },
      },
    }));

  const setInfoRow = (row: DocumentInfoRow, patch: { enabled?: boolean; label?: string }) =>
    setConfig((c) => ({
      ...c,
      documentInfo: {
        ...c.documentInfo,
        rows: { ...c.documentInfo.rows, [row]: { ...c.documentInfo.rows[row], ...patch } },
      },
    }));

  const setColumn = (col: ItemColumn, patch: { enabled?: boolean; label?: string }) =>
    setConfig((c) => ({
      ...c,
      itemTable: {
        ...c.itemTable,
        columns: { ...c.itemTable.columns, [col]: { ...c.itemTable.columns[col], ...patch } },
      },
    }));

  const setTotalRow = (
    row: (typeof TOTAL_ROWS)[number],
    patch: { enabled?: boolean; label?: string }
  ) =>
    setConfig((c) => ({
      ...c,
      itemTable: {
        ...c.itemTable,
        totals: { ...c.itemTable.totals, [row]: { ...c.itemTable.totals[row], ...patch } },
      },
    }));

  const setBottom = (patch: Partial<DocumentTemplateConfig["bottomSections"]>) =>
    setConfig((c) => ({ ...c, bottomSections: { ...c.bottomSections, ...patch } }));

  const toggleCustomField = (id: string, on: boolean) =>
    setConfig((c) => ({
      ...c,
      customFieldIds: on
        ? [...c.customFieldIds, id]
        : c.customFieldIds.filter((x) => x !== id),
    }));

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------
  const handleSave = useCallback(async () => {
    if (!accountId) {
      toast.error("No account loaded.");
      return;
    }
    if (name.trim() === "") {
      toast.error("Give the template a name.");
      return;
    }

    setSaving(true);
    try {
      if (templateId) {
        await updateTemplate(supabase, templateId, name, config);
      } else {
        await createTemplate(supabase, accountId, module, name, config, user?.id);
      }
      toast.success(`"${name.trim()}" saved.`);
      router.push("/settings?tab=document_templates");
    } catch (err: any) {
      // 23505 is the unique index on (account, module, name).
      const message =
        err?.code === "23505"
          ? `A ${MODULE_LABELS[module]} template called "${name.trim()}" already exists.`
          : err?.message ?? "Unknown error";
      toast.error(`Could not save: ${message}`);
    } finally {
      setSaving(false);
    }
  }, [accountId, name, config, templateId, module, supabase, router, user?.id]);

  const visibleInfoRows = useMemo(
    () => caps.documentInfoRows.filter((r) => r !== "createdByEmail" && r !== "createdByContact"),
    [caps.documentInfoRows]
  );

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      {/* Top Navigation Bar */}
      <div className="h-14 border-b flex items-center justify-between px-4 bg-card shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="size-4" />
          </Button>
          <div className="font-semibold text-lg flex items-center gap-2 text-foreground">
            {templateId ? "Edit Template" : "New Template"}
            <span className="text-sm font-normal text-muted-foreground">
              · {MODULE_LABELS[module]}
            </span>
          </div>
        </div>
        <Button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700">
          {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
          SAVE
        </Button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar Configurator */}
        <div className="w-[350px] border-r bg-muted/20 overflow-y-auto flex flex-col">
          <div className="p-4 border-b bg-card shrink-0">
            <Label className="text-muted-foreground text-xs font-semibold mb-2 block">
              Template Name *
            </Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="bg-white" />
          </div>

          <Accordion className="flex-1 w-full p-2 space-y-2">
            <AccordionItem value="header" className="border rounded-lg bg-card px-2">
              <AccordionTrigger className="text-sm font-semibold hover:no-underline py-3">
                Header
              </AccordionTrigger>
              <AccordionContent className="space-y-3 pt-1 pb-3">
                {HEADER_FIELDS.map(({ key, label }) => (
                  <div key={key} className="flex items-center space-x-2">
                    <Checkbox
                      id={`hdr-${key}`}
                      checked={config.header[key]}
                      onCheckedChange={(c) => setHeader(key, !!c)}
                    />
                    <label
                      htmlFor={`hdr-${key}`}
                      className="text-sm font-medium leading-none cursor-pointer"
                    >
                      {label}
                    </label>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground pt-1">
                  Filled from Settings → Company Profile.
                </p>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="doc-info" className="border rounded-lg bg-card px-2">
              <AccordionTrigger className="text-sm font-semibold hover:no-underline py-3">
                Document Info
              </AccordionTrigger>
              <AccordionContent className="space-y-4 pt-1 pb-3">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="doc-serial"
                    checked={config.documentInfo.serialNo}
                    onCheckedChange={(c) =>
                      setConfig((cfg) => ({
                        ...cfg,
                        documentInfo: { ...cfg.documentInfo, serialNo: !!c },
                      }))
                    }
                  />
                  <label htmlFor="doc-serial" className="text-sm font-medium leading-none cursor-pointer">
                    Serial No
                  </label>
                </div>

                {(["billTo", "shipTo"] as const).map((which) => {
                  const s = config.documentInfo[which];
                  return (
                    <div key={which} className="border p-3 rounded-md bg-muted/10 space-y-3 mt-4">
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={s.enabled}
                          onCheckedChange={(c) => setParty(which, { enabled: !!c })}
                        />
                        <Input
                          value={s.label}
                          onChange={(e) => setParty(which, { label: e.target.value })}
                          className="h-8 text-sm font-semibold"
                        />
                      </div>
                      <div className="pl-6 space-y-2">
                        {PARTY_FIELDS.map((f) => (
                          <div key={f.key} className="flex items-center space-x-2">
                            <Checkbox
                              id={`${which}-${f.key}`}
                              checked={s[f.key] as boolean}
                              disabled={!s.enabled}
                              onCheckedChange={(c) => setParty(which, { [f.key]: !!c } as Partial<PartyBlock>)}
                            />
                            <label
                              htmlFor={`${which}-${f.key}`}
                              className="text-xs font-medium cursor-pointer text-muted-foreground"
                            >
                              {f.label}
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}

                <div className="pt-2 border-t mt-4 space-y-3">
                  {visibleInfoRows.map((row) => {
                    const v = config.documentInfo.rows[row];
                    return (
                      <div key={row} className="flex items-center gap-3">
                        <Checkbox
                          checked={v.enabled}
                          onCheckedChange={(c) => setInfoRow(row, { enabled: !!c })}
                        />
                        <Input
                          value={v.label}
                          onChange={(e) => setInfoRow(row, { label: e.target.value })}
                          className="h-8 text-xs"
                          disabled={!v.enabled}
                        />
                      </div>
                    );
                  })}
                </div>
              </AccordionContent>
            </AccordionItem>

            {caps.customFields && (
              <AccordionItem value="custom-fields" className="border rounded-lg bg-card px-2">
                <AccordionTrigger className="text-sm font-semibold hover:no-underline py-3">
                  Custom Fields
                </AccordionTrigger>
                <AccordionContent className="space-y-3 pt-1 pb-3">
                  {customFields.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No custom fields defined for {MODULE_LABELS[module]}.
                    </p>
                  ) : (
                    customFields.map((cf) => (
                      <div key={cf.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={`cf-${cf.id}`}
                          checked={config.customFieldIds.includes(cf.id)}
                          onCheckedChange={(c) => toggleCustomField(cf.id, !!c)}
                        />
                        <label
                          htmlFor={`cf-${cf.id}`}
                          className="text-sm font-medium leading-none cursor-pointer"
                        >
                          {cf.label}
                        </label>
                      </div>
                    ))
                  )}
                </AccordionContent>
              </AccordionItem>
            )}

            {caps.itemTable && (
              <AccordionItem value="item-table" className="border rounded-lg bg-card px-2">
                <AccordionTrigger className="text-sm font-semibold hover:no-underline py-3">
                  Item Table
                </AccordionTrigger>
                <AccordionContent className="space-y-3 pt-1 pb-3">
                  {ITEM_COLUMNS.filter((col) => caps.itemColumns.includes(col)).map((col) => {
                    const v = config.itemTable.columns[col];
                    return (
                      <div key={col} className="flex items-center gap-3">
                        <Checkbox
                          id={`tbl-${col}`}
                          checked={v.enabled}
                          onCheckedChange={(c) => setColumn(col, { enabled: !!c })}
                        />
                        <Input
                          value={v.label}
                          onChange={(e) => setColumn(col, { label: e.target.value })}
                          className="h-8 text-xs"
                          disabled={!v.enabled}
                        />
                      </div>
                    );
                  })}

                  {caps.totals.length > 0 && (
                    <div className="pt-3 border-t mt-3 space-y-3">
                      <p className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wide">
                        Totals
                      </p>
                      {TOTAL_ROWS.filter((r) => caps.totals.includes(r)).map((row) => {
                        const v = config.itemTable.totals[row];
                        return (
                          <div key={row} className="flex items-center gap-3">
                            <Checkbox
                              checked={v.enabled}
                              onCheckedChange={(c) => setTotalRow(row, { enabled: !!c })}
                            />
                            <Input
                              value={v.label}
                              onChange={(e) => setTotalRow(row, { label: e.target.value })}
                              className="h-8 text-xs"
                              disabled={!v.enabled}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {module === "dispatch" && (
                    <p className="text-xs text-muted-foreground pt-2 border-t mt-3">
                      A dispatch records what left the warehouse, not what it cost — dispatch
                      lines carry no prices, so there are no amount columns to show.
                    </p>
                  )}
                </AccordionContent>
              </AccordionItem>
            )}

            <AccordionItem value="bottom-sections" className="border rounded-lg bg-card px-2">
              <AccordionTrigger className="text-sm font-semibold hover:no-underline py-3">
                Bottom Sections
              </AccordionTrigger>
              <AccordionContent className="space-y-5 pt-1 pb-3">
                {caps.totalQuantity && (
                  <div className="space-y-3">
                    <p className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wide">
                      Total Quantity
                    </p>
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={config.bottomSections.totalQuantity.enabled}
                        onCheckedChange={(c) =>
                          setBottom({
                            totalQuantity: { ...config.bottomSections.totalQuantity, enabled: !!c },
                          })
                        }
                      />
                      <Input
                        value={config.bottomSections.totalQuantity.label}
                        onChange={(e) =>
                          setBottom({
                            totalQuantity: {
                              ...config.bottomSections.totalQuantity,
                              label: e.target.value,
                            },
                          })
                        }
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-3 pt-4 border-t">
                  <p className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wide">
                    Signature
                  </p>
                  <div className="flex items-center gap-3">
                    <Checkbox
                      checked={config.bottomSections.signature.enabled}
                      onCheckedChange={(c) =>
                        setBottom({
                          signature: { ...config.bottomSections.signature, enabled: !!c },
                        })
                      }
                    />
                    <span className="text-xs w-16 text-muted-foreground font-medium">Label</span>
                    <Input
                      value={config.bottomSections.signature.label}
                      onChange={(e) =>
                        setBottom({
                          signature: { ...config.bottomSections.signature, label: e.target.value },
                        })
                      }
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs w-16 text-muted-foreground font-medium pl-6">Name</span>
                    <Input
                      value={config.bottomSections.signature.name}
                      onChange={(e) =>
                        setBottom({
                          signature: { ...config.bottomSections.signature, name: e.target.value },
                        })
                      }
                      placeholder="Printed under the signature line"
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <Checkbox
                      checked={config.bottomSections.signature.image}
                      onCheckedChange={(c) =>
                        setBottom({
                          signature: { ...config.bottomSections.signature, image: !!c },
                        })
                      }
                    />
                    <span className="text-xs font-medium">Signature image</span>
                  </div>
                  {config.bottomSections.signature.image && (
                    <div className="pl-6 pt-1 space-y-2">
                      {config.bottomSections.signature.attachmentUrl ? (
                        <div className="flex items-center gap-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={config.bottomSections.signature.attachmentUrl}
                            alt="Signature"
                            className="h-10 object-contain border rounded bg-white px-2"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            onClick={() =>
                              setBottom({
                                signature: { ...config.bottomSections.signature, attachmentUrl: '' },
                              })
                            }
                          >
                            <X className="size-4" />
                          </Button>
                        </div>
                      ) : (
                        <label className="flex items-center justify-center gap-2 w-full h-9 border border-dashed rounded-md cursor-pointer text-xs text-muted-foreground hover:bg-muted">
                          {uploadingSignature ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <>
                              <UploadCloud className="size-4" /> Attach a signature image
                            </>
                          )}
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="hidden"
                            disabled={uploadingSignature}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleSignatureUpload(file);
                              e.target.value = '';
                            }}
                          />
                        </label>
                      )}
                      <p className="text-[11px] text-muted-foreground">
                        PNG, JPEG or WebP, up to 2 MB. A transparent PNG sits best on the page.
                      </p>
                    </div>
                  )}
                </div>

                <div className="space-y-3 pt-4 border-t">
                  <p className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wide">
                    Additional Signature
                  </p>
                  <div className="flex items-center gap-3">
                    <Checkbox
                      checked={config.bottomSections.additionalSignature.enabled}
                      onCheckedChange={(c) =>
                        setBottom({
                          additionalSignature: {
                            ...config.bottomSections.additionalSignature,
                            enabled: !!c,
                          },
                        })
                      }
                    />
                    <span className="text-xs w-16 text-muted-foreground font-medium">Label</span>
                    <Input
                      value={config.bottomSections.additionalSignature.label}
                      onChange={(e) =>
                        setBottom({
                          additionalSignature: {
                            ...config.bottomSections.additionalSignature,
                            label: e.target.value,
                          },
                        })
                      }
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs w-16 text-muted-foreground font-medium pl-6">Name</span>
                    <Input
                      value={config.bottomSections.additionalSignature.name}
                      onChange={(e) =>
                        setBottom({
                          additionalSignature: {
                            ...config.bottomSections.additionalSignature,
                            name: e.target.value,
                          },
                        })
                      }
                      placeholder="Optional"
                      className="h-8 text-xs"
                    />
                  </div>
                </div>

                <div className="space-y-3 pt-4 border-t">
                  <p className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wide">
                    Footer
                  </p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={config.bottomSections.footer.enabled}
                        onCheckedChange={(c) =>
                          setBottom({ footer: { ...config.bottomSections.footer, enabled: !!c } })
                        }
                      />
                      <span className="text-sm font-medium">Terms &amp; Conditions</span>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => setManageFooterOpen(true)}
                      className="h-7 px-3 text-[10px] font-bold tracking-wider bg-blue-500 hover:bg-blue-600"
                    >
                      MANAGE
                    </Button>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>

        {/* Right Pane Preview */}
        <div className="flex-1 bg-muted/30 p-8 overflow-y-auto flex justify-center">
          <Card className="w-full max-w-[800px] min-h-[1131px] bg-white shadow-md p-10 flex flex-col">
            <DocumentTemplatePreview
              module={module}
              config={config}
              customFields={customFields.filter((cf) => config.customFieldIds.includes(cf.id))}
            />
          </Card>
        </div>
      </div>

      <Dialog open={manageFooterOpen} onOpenChange={setManageFooterOpen}>
        <DialogContent className="sm:max-w-[600px] p-0 overflow-hidden gap-0 bg-card border-border">
          <DialogHeader className="p-4 border-b border-border">
            <DialogTitle className="text-2xl font-normal text-muted-foreground">
              Manage Footer
            </DialogTitle>
          </DialogHeader>
          <div className="p-4 py-6">
            <Label className="text-muted-foreground/80 text-sm font-medium mb-2 block">
              Terms &amp; Conditions
            </Label>
            <div className="border rounded-sm overflow-hidden border-border bg-background shadow-sm">
              <Textarea
                value={config.bottomSections.footer.text}
                onChange={(e) =>
                  setBottom({ footer: { ...config.bottomSections.footer, text: e.target.value } })
                }
                rows={7}
                className="w-full text-[13px] text-foreground resize-none border-0 focus-visible:ring-0 rounded-none bg-transparent placeholder:text-muted-foreground p-4"
                placeholder={"1. Goods once sold will not be taken back.\n2. Subject to Rajkot jurisdiction."}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Plain text. Each line prints as its own line on the document.
            </p>
          </div>
          <DialogFooter className="p-4 border-t border-border bg-card">
            <Button
              className="bg-[#3b82f6] hover:bg-blue-600 text-white font-bold px-6 tracking-wide text-xs h-9"
              onClick={() => setManageFooterOpen(false)}
            >
              DONE
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
