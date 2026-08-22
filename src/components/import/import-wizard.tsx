"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Upload,
  FileText,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Download,
  ArrowRight,
  ArrowLeft,
  Undo2,
  RotateCcw,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { getImportDescriptor } from "@/lib/import/registry";
import { buildImportDescriptor } from "@/lib/import/build-descriptor";
import { parseFile } from "@/lib/import/parse";
import { detectMapping, unmappedRequiredFields } from "@/lib/import/mapping";
import { buildMappedRows, validateRows, buildCommitRows } from "@/lib/import/validate";
import { detectUnknownLookups, applyResolutions, rewriteRows } from "@/lib/import/resolve-lookups";
import { loadExistingKeys, createImportJob, commitInChunks } from "@/lib/import/run";
import { buildTemplateCsv, buildErrorCsv, downloadText } from "@/lib/import/error-report";
import { PERMISSIONS } from "@/lib/auth/permissions-registry";
import type {
  ColumnMapping,
  ImportMode,
  LookupResolveGroup,
  ParsedFile,
  ResolveAction,
  ResolveSelections,
  ValidationSummary,
} from "@/lib/import/types";

type Step = "upload" | "map" | "preview" | "resolve" | "result";
const PREVIEW_LIMIT = 8;
const IGNORE = "__ignore__";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  module: string;
  onImported?: () => void;
}

interface ResultState {
  jobId: string;
  imported: number;
  updated: number;
  skipped: number;
  failed: number;
  invalidCount: number;
  undoable: boolean;
}

const CONFIDENCE_STYLE: Record<string, string> = {
  high: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  medium: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  low: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  none: "bg-muted text-muted-foreground",
};

export function ImportWizard({ open, onOpenChange, module, onImported }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const { accountId, user, hasPermission, isModuleEnabled } = useAuth();
  const baseDescriptor = getImportDescriptor(module);
  const fileRef = useRef<HTMLInputElement>(null);

  // Form-backed modules (Customers/Products/Leads) generate their field set at
  // runtime from the tenant's `custom_fields` config, so the importer mirrors
  // manual entry exactly. Masters resolve to their static descriptor instantly.
  const [descriptor, setDescriptor] = useState<typeof baseDescriptor>(baseDescriptor);
  const [descLoading, setDescLoading] = useState(false);

  useEffect(() => {
    if (!open || !baseDescriptor || !accountId) return;
    if (!baseDescriptor.formBacked) {
      setDescriptor(baseDescriptor);
      return;
    }
    let cancelled = false;
    setDescLoading(true);
    buildImportDescriptor(supabase, baseDescriptor, accountId, {
      territoryEnabled: isModuleEnabled("territory"),
    })
      .then((d) => {
        if (!cancelled) setDescriptor(d);
      })
      .catch(() => {
        if (!cancelled) setDescriptor(baseDescriptor);
      })
      .finally(() => {
        if (!cancelled) setDescLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, module, accountId]);

  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [mode, setMode] = useState<ImportMode>("skip");
  const [summary, setSummary] = useState<ValidationSummary | null>(null);
  const [resolveGroups, setResolveGroups] = useState<LookupResolveGroup[]>([]);
  const [resolveSel, setResolveSel] = useState<ResolveSelections>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ResultState | null>(null);

  const canManage = hasPermission(PERMISSIONS.IMPORT.MANAGE);

  const reset = useCallback(() => {
    setStep("upload");
    setFile(null);
    setParsed(null);
    setMappings([]);
    setMode("skip");
    setSummary(null);
    setResolveGroups([]);
    setResolveSel({});
    setBusy(false);
    setProgress(0);
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  if (!descriptor) return null;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f || !descriptor) return;
    setFile(f);
    setBusy(true);
    try {
      const p = await parseFile(f);
      if (p.headers.length === 0 || p.rows.length === 0) {
        toast.error("That file has no data rows. Check the file and try again.");
        setBusy(false);
        return;
      }
      setParsed(p);
      setMappings(detectMapping(p.headers, descriptor));
      setStep("map");
    } catch {
      toast.error("Could not read that file. Supported formats: CSV, XLSX.");
    } finally {
      setBusy(false);
    }
  }

  function setColumnField(index: number, fieldKey: string | null) {
    setMappings((prev) =>
      prev.map((m, i) =>
        i === index ? { ...m, fieldKey: !fieldKey || fieldKey === IGNORE ? null : fieldKey, auto: false } : m,
      ),
    );
  }

  const missingRequired = descriptor ? unmappedRequiredFields(mappings, descriptor) : [];

  async function goToPreview() {
    if (!parsed || !descriptor || !accountId) return;
    setBusy(true);
    try {
      const mapped = buildMappedRows(parsed, mappings);
      const existing = await loadExistingKeys(supabase, descriptor, accountId);
      const s = validateRows(mapped, descriptor, existing);
      setSummary(s);
      // Detect unknown lookup values (unknown territories/categories/…) so the
      // admin can resolve them in bulk before anything is written.
      const groups = await detectUnknownLookups(supabase, descriptor, s.rows, accountId);
      setResolveGroups(groups);
      const defaults: ResolveSelections = {};
      for (const g of groups) {
        defaults[g.field] = {};
        for (const u of g.unknowns) {
          defaults[g.field][u.value.toLowerCase()] =
            g.createable === "admin" && canManage ? { type: "create" } : { type: "blank" };
        }
      }
      setResolveSel(defaults);
      setStep("preview");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not validate the file.");
    } finally {
      setBusy(false);
    }
  }

  // From Preview: if there are unknown lookup values, resolve them first.
  function proceedFromPreview() {
    if (resolveGroups.length > 0) setStep("resolve");
    else runImport();
  }

  function setAction(field: string, valueLower: string, action: ResolveAction) {
    setResolveSel((prev) => ({ ...prev, [field]: { ...(prev[field] ?? {}), [valueLower]: action } }));
  }

  async function applyResolveAndImport() {
    if (!summary || !accountId) return;
    setBusy(true);
    try {
      const { rewrite, created, errors } = await applyResolutions(
        supabase,
        resolveGroups,
        resolveSel,
        accountId,
        canManage,
      );
      rewriteRows(summary.rows, rewrite);
      if (created > 0) toast.success(`${created} new value${created === 1 ? "" : "s"} created.`);
      for (const e of errors) toast.error(e);
      await runImport();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not apply your choices.");
      setBusy(false);
    }
  }

  const importableCount = summary ? summary.valid + (mode === "update" ? summary.duplicate : 0) : 0;

  function downloadErrorReport() {
    if (!summary || !descriptor) return;
    if (summary.invalid === 0) {
      toast.info("No invalid rows to report.");
      return;
    }
    downloadText(`${descriptor.module}_import_errors.csv`, buildErrorCsv(descriptor, summary.rows));
  }

  async function runImport() {
    if (!summary || !descriptor || !accountId || !user || !parsed || !file) return;
    const rows = buildCommitRows(summary, mode, descriptor);
    if (rows.length === 0) {
      toast.info(mode === "skip" ? "Nothing new to import." : "No rows to import or update.");
      return;
    }
    setBusy(true);
    setProgress(0);
    try {
      const mappingRecord: Record<string, string> = {};
      for (const m of mappings) if (m.fieldKey) mappingRecord[m.sourceHeader] = m.fieldKey;

      const jobId = await createImportJob(supabase, {
        accountId,
        userId: user.id,
        descriptor,
        fileName: file.name,
        fileSize: file.size,
        sourceFormat: parsed.format,
        mode,
        mapping: mappingRecord,
        summary,
      });

      const res = await commitInChunks(supabase, jobId, rows, (done, total) =>
        setProgress(Math.round((done / total) * 100)),
      );

      // Undoable only if the run actually created rows and the target supports it.
      const undoable = descriptor.undoable && res.imported > 0;
      setResult({ jobId, ...res, invalidCount: summary.invalid, undoable });
      setStep("result");
      if (res.imported > 0 || res.updated > 0) onImported?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Import failed.";
      toast.error(msg.includes("permission") ? "You do not have permission to import here." : msg);
    } finally {
      setBusy(false);
    }
  }

  async function undoImport() {
    if (!result) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("import_undo", { p_job_id: result.jobId });
      if (error) throw error;
      const removed = (data as { removed?: number })?.removed ?? 0;
      toast.success(`Import undone — ${removed} record${removed === 1 ? "" : "s"} removed.`);
      onImported?.();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not undo the import.");
    } finally {
      setBusy(false);
    }
  }

  const preview = summary?.rows.slice(0, PREVIEW_LIMIT) ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto p-4 sm:p-6 sm:!max-w-5xl">
        <SheetHeader>
          <SheetTitle>Import {descriptor.label}</SheetTitle>
          <SheetDescription>
            {step === "upload" && "Upload a CSV or Excel file to bulk-add records."}
            {step === "map" && "Match your file's columns to the fields below."}
            {step === "preview" && "Review what will be imported before anything is saved."}
            {step === "resolve" && "Resolve unknown values in bulk — decide once, import clean."}
            {step === "result" && "Import complete."}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-5">
          {/* ---- STEP: UPLOAD ---- */}
          {step === "upload" && (
            <>
              <div
                role="button"
                tabIndex={0}
                onClick={() => !descLoading && fileRef.current?.click()}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !descLoading && fileRef.current?.click()}
                className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 py-10 hover:bg-muted/50"
              >
                {busy || descLoading ? (
                  <Loader2 className="size-7 animate-spin text-muted-foreground" />
                ) : (
                  <Upload className="size-7 text-muted-foreground" />
                )}
                <p className="text-sm font-medium">{descLoading ? "Loading this module's fields…" : busy ? "Reading file…" : "Click to choose a CSV or XLSX file"}</p>
                <p className="text-xs text-muted-foreground">First row = column headers · one record per row below</p>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,.xls,text/csv"
                className="hidden"
                onChange={onFile}
              />
              <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-sm">
                <span className="text-muted-foreground">Not sure of the format?</span>
                <Button
                  variant="link"
                  className="h-auto p-0 text-primary"
                  onClick={() =>
                    downloadText(`${descriptor.module}_template.csv`, buildTemplateCsv(descriptor))
                  }
                >
                  <Download className="mr-1 size-3.5" /> Download template
                </Button>
              </div>
            </>
          )}

          {/* ---- STEP: MAP ---- */}
          {step === "map" && parsed && (
            <>
              <div className="rounded-lg border border-border">
                <div className="border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {parsed.headers.length} columns · {parsed.rows.length} rows
                </div>
                <div className="divide-y divide-border/60">
                  {mappings.map((m, i) => {
                    const sample = parsed.rows.find((r) => (r[m.sourceIndex] ?? "").trim())?.[m.sourceIndex] ?? "";
                    return (
                      <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium">{m.sourceHeader || <em className="text-muted-foreground">(blank header)</em>}</span>
                            {m.auto && m.fieldKey && (
                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${CONFIDENCE_STYLE[m.confidence]}`}>
                                {m.confidence === "high" ? "matched" : "check"}
                              </span>
                            )}
                          </div>
                          {sample && <p className="truncate text-xs text-muted-foreground">e.g. {sample}</p>}
                        </div>
                        <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                        <Select value={m.fieldKey ?? IGNORE} onValueChange={(v) => setColumnField(i, v)}>
                          <SelectTrigger className="w-56 shrink-0">
                            <SelectValue>
                              {(v: string) =>
                                v === IGNORE
                                  ? "Ignore this column"
                                  : descriptor.fields.find((f) => f.key === v)?.label ?? "Ignore this column"
                              }
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={IGNORE}>Ignore this column</SelectItem>
                            {descriptor.fields.map((f) => (
                              <SelectItem key={f.key} value={f.key}>
                                {f.label}
                                {f.required ? " *" : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })}
                </div>
              </div>

              {missingRequired.length > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>Map these required fields before continuing: <b>{missingRequired.join(", ")}</b></span>
                </div>
              )}

              <div className="flex justify-between gap-2">
                <Button variant="outline" onClick={() => setStep("upload")}>
                  <ArrowLeft className="mr-1 size-4" /> Back
                </Button>
                <Button onClick={goToPreview} disabled={busy || missingRequired.length > 0}>
                  {busy ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
                  Preview <ArrowRight className="ml-1 size-4" />
                </Button>
              </div>
            </>
          )}

          {/* ---- STEP: PREVIEW ---- */}
          {step === "preview" && summary && (
            <>
              <div className="grid grid-cols-4 gap-2">
                <VerdictTile n={summary.total} label="Total" />
                <VerdictTile n={summary.valid} label="Valid" tone="good" />
                <VerdictTile n={summary.invalid} label="Invalid" tone="bad" />
                <VerdictTile n={summary.duplicate} label="Duplicate" tone="warn" />
              </div>

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  When a record already exists
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <ModeCard
                    active={mode === "skip"}
                    onClick={() => setMode("skip")}
                    title="Skip existing"
                    desc="Only add new records. Existing ones are left untouched."
                  />
                  <ModeCard
                    active={mode === "update"}
                    onClick={() => setMode("update")}
                    title="Update existing"
                    desc="Add new records and refresh matching ones from the file."
                  />
                </div>
              </div>

              <div className="overflow-hidden rounded-lg border border-border">
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/60">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Row</th>
                        {descriptor.fields.map((f) => (
                          <th key={f.key} className="px-2 py-1.5 text-left font-medium text-muted-foreground">{f.label}</th>
                        ))}
                        <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {preview.map((r) => (
                        <tr key={r.row} className={r.status === "invalid" ? "bg-red-500/5" : r.status === "duplicate" ? "bg-amber-500/5" : ""}>
                          <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{r.row}</td>
                          {descriptor.fields.map((f) => (
                            <td key={f.key} className="px-2 py-1.5">{r.values[f.key] || <span className="text-muted-foreground">—</span>}</td>
                          ))}
                          <td className="px-2 py-1.5">
                            {r.status === "valid" && <span className="text-emerald-600 dark:text-emerald-400">OK</span>}
                            {r.status === "duplicate" && <span className="text-amber-600 dark:text-amber-400">Duplicate</span>}
                            {r.status === "invalid" && (
                              <span className="text-red-600 dark:text-red-400" title={r.errors.map((e) => e.message).join("; ")}>
                                {r.errors[0]?.message ?? "Invalid"}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {summary.total > PREVIEW_LIMIT && (
                  <div className="border-t border-border px-2 py-1 text-center text-[11px] text-muted-foreground">
                    + {summary.total - PREVIEW_LIMIT} more rows
                  </div>
                )}
              </div>

              {resolveGroups.length > 0 && (
                <div className="rounded-xl border border-primary/40 bg-primary/5 p-3.5">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <AlertTriangle className="size-4 text-primary" />
                    Some values need a decision — {resolveGroups.reduce((n, g) => n + g.unknowns.length, 0)}{" "}
                    {resolveGroups.map((g) => g.label.toLowerCase()).join(" / ")} not in your master data yet
                  </div>
                  <p className="mt-1 pl-6 text-xs text-muted-foreground">
                    In the next step you&apos;ll create or match each one, once — so every record imports with no review queue.
                  </p>
                </div>
              )}

              {busy && <Progress value={progress} className="h-2" />}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button variant="outline" onClick={() => setStep("map")} disabled={busy}>
                  <ArrowLeft className="mr-1 size-4" /> Back
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={downloadErrorReport} disabled={summary.invalid === 0}>
                    <Download className="mr-1 size-4" /> Validate only
                  </Button>
                  <Button onClick={proceedFromPreview} disabled={busy || importableCount === 0}>
                    {busy ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
                    {resolveGroups.length > 0 ? (
                      <>Resolve {resolveGroups.reduce((n, g) => n + g.unknowns.length, 0)} value{resolveGroups.reduce((n, g) => n + g.unknowns.length, 0) === 1 ? "" : "s"} <ArrowRight className="ml-1 size-4" /></>
                    ) : (
                      <>Import {importableCount}</>
                    )}
                  </Button>
                </div>
              </div>
            </>
          )}

          {/* ---- STEP: RESOLVE (unknown lookup values) ---- */}
          {step === "resolve" && (
            <>
              <p className="text-sm text-muted-foreground">
                Some values in your file don&apos;t exist yet. Decide once for each — everything then imports clean, with no review queue.
              </p>
              <div className="space-y-5">
                {resolveGroups.map((g) => (
                  <div key={g.field}>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Unknown {g.label} · {g.unknowns.length} value{g.unknowns.length === 1 ? "" : "s"}
                    </p>
                    <div className="space-y-2">
                      {g.unknowns.map((u) => {
                        const keyL = u.value.toLowerCase();
                        const sel = resolveSel[g.field]?.[keyL] ?? { type: "blank" as const };
                        const opts = g.existing;
                        const singular = g.label.toLowerCase();
                        const canCreateHere = g.createable === "admin" && canManage;
                        const parentOptions = [
                          { label: "Top level (no parent)", value: "__top__" },
                          ...opts.map((e) => ({ label: e.path ?? e.name, value: e.id })),
                        ];
                        const existingOptions = opts.map((e) => ({ label: e.path ?? e.name, value: e.id }));
                        return (
                          <div key={u.value} className="rounded-lg border border-border bg-card p-3">
                            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                              <div className="min-w-0">
                                <span className="text-sm font-semibold">{u.value}</span>
                                <span className="ml-2 text-xs text-muted-foreground">
                                  {u.count} record{u.count === 1 ? "" : "s"}
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5">
                                {canCreateHere && (
                                  <Button type="button" size="sm" variant={sel.type === "create" ? "default" : "outline"}
                                    onClick={() => setAction(g.field, keyL, { type: "create" })}>
                                    Create new {singular}
                                  </Button>
                                )}
                                <Button type="button" size="sm" variant={sel.type === "map" ? "default" : "outline"}
                                  onClick={() => setAction(g.field, keyL, { type: "map", toId: "", toName: "" })}>
                                  Use existing
                                </Button>
                                <Button type="button" size="sm" variant={sel.type === "blank" ? "default" : "outline"}
                                  onClick={() => setAction(g.field, keyL, { type: "blank" })}>
                                  Skip
                                </Button>
                              </div>
                            </div>

                            {sel.type === "create" && g.hierarchical && canCreateHere && (
                              <div className="mt-3 space-y-1.5">
                                <p className="text-xs text-muted-foreground">
                                  Create <span className="font-medium text-foreground">{u.value}</span> under:
                                </p>
                                <SearchableSelect
                                  className="max-w-xl"
                                  options={parentOptions}
                                  value={sel.parentId ?? "__top__"}
                                  onChange={(v) =>
                                    setAction(g.field, keyL, { type: "create", parentId: v && v !== "__top__" ? v : undefined })
                                  }
                                  placeholder="Top level (no parent)"
                                  searchPlaceholder={`Search ${singular}…`}
                                />
                              </div>
                            )}
                            {sel.type === "create" && !g.hierarchical && canCreateHere && (
                              <p className="mt-3 text-xs text-muted-foreground">
                                A new {singular} <span className="font-medium text-foreground">{u.value}</span> will be created.
                              </p>
                            )}

                            {sel.type === "map" && (
                              <div className="mt-3 space-y-1.5">
                                <p className="text-xs text-muted-foreground">Point these records at an existing {singular}:</p>
                                <SearchableSelect
                                  className="max-w-xl"
                                  options={existingOptions}
                                  value={sel.toId || ""}
                                  onChange={(v) => {
                                    const node = opts.find((e) => e.id === v);
                                    if (node) setAction(g.field, keyL, { type: "map", toId: node.id, toName: node.name });
                                  }}
                                  placeholder={`Search and pick a ${singular}…`}
                                  searchPlaceholder={`Search ${singular}…`}
                                />
                              </div>
                            )}

                            {sel.type === "blank" && (
                              <p className="mt-3 text-xs text-muted-foreground">These records will import with no {singular}.</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {busy && <Progress value={progress} className="h-2" />}

              <div className="flex items-center justify-between gap-2">
                <Button variant="outline" onClick={() => setStep("preview")} disabled={busy}>
                  <ArrowLeft className="mr-1 size-4" /> Back
                </Button>
                <Button onClick={applyResolveAndImport} disabled={busy}>
                  {busy ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
                  Import {importableCount}
                </Button>
              </div>
            </>
          )}

          {/* ---- STEP: RESULT ---- */}
          {step === "result" && result && (
            <>
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="mb-3 flex items-center gap-2">
                  {result.failed === 0 && result.invalidCount === 0 ? (
                    <CheckCircle2 className="size-5 text-emerald-500" />
                  ) : (
                    <AlertTriangle className="size-5 text-amber-500" />
                  )}
                  <span className="font-medium">Import complete</span>
                </div>
                <div className="flex flex-wrap gap-4 text-sm">
                  {result.imported > 0 && <ResultStat n={result.imported} label="imported" tone="good" />}
                  {result.updated > 0 && <ResultStat n={result.updated} label="updated" tone="good" />}
                  {result.skipped > 0 && <ResultStat n={result.skipped} label="skipped" tone="warn" />}
                  {(result.failed > 0 || result.invalidCount > 0) && (
                    <ResultStat n={result.failed + result.invalidCount} label="failed/invalid" tone="bad" />
                  )}
                </div>
              </div>

              {result.invalidCount > 0 && (
                <Button variant="outline" className="w-full" onClick={downloadErrorReport}>
                  <Download className="mr-1 size-4" /> Download error report ({result.invalidCount} rows)
                </Button>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                {result.undoable && canManage ? (
                  <Button variant="outline" onClick={undoImport} disabled={busy} className="text-amber-600 dark:text-amber-400">
                    {busy ? <Loader2 className="mr-1 size-4 animate-spin" /> : <Undo2 className="mr-1 size-4" />}
                    Undo import
                  </Button>
                ) : (
                  <span />
                )}
                <div className="flex gap-2">
                  <Button variant="outline" onClick={reset}>
                    <RotateCcw className="mr-1 size-4" /> Import another
                  </Button>
                  <Button onClick={() => onOpenChange(false)}>Done</Button>
                </div>
              </div>
              {result.undoable && canManage && (
                <p className="text-center text-[11px] text-muted-foreground">
                  You can undo this import for the next 30 minutes, or until another import runs.
                </p>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function VerdictTile({ n, label, tone }: { n: number; label: string; tone?: "good" | "bad" | "warn" }) {
  const color =
    tone === "good" ? "text-emerald-600 dark:text-emerald-400"
    : tone === "bad" ? "text-red-600 dark:text-red-400"
    : tone === "warn" ? "text-amber-600 dark:text-amber-400"
    : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-card px-2 py-2.5 text-center">
      <div className={`text-xl font-bold tabular-nums ${color}`}>{n}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function ModeCard({ active, onClick, title, desc }: { active: boolean; onClick: () => void; title: string; desc: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border p-3 text-left transition-colors ${active ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "border-border hover:bg-muted/40"}`}
    >
      <div className="text-sm font-medium">{title}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{desc}</div>
    </button>
  );
}

function ResultStat({ n, label, tone }: { n: number; label: string; tone: "good" | "bad" | "warn" }) {
  const color =
    tone === "good" ? "text-emerald-600 dark:text-emerald-400"
    : tone === "bad" ? "text-red-600 dark:text-red-400"
    : "text-amber-600 dark:text-amber-400";
  return (
    <span className="flex items-center gap-1.5">
      <b className={`tabular-nums ${color}`}>{n}</b>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}
