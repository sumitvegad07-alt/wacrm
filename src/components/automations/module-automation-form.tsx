"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GripVertical, Loader2, Pencil, Plus, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  buildExpressionFromRelations,
  parseConditionExpression,
} from "@/lib/automations/condition-expression";
import type { AutomationModule } from "@/lib/automations/field-catalog";

// ------------------------------------------------------------
// The Add Automation form.
//
// Field order follows the founder's reference design exactly: Name, Module,
// Event, Action, WhatsApp template, Send to, Condition(s), Condition format.
//
// Two behaviours are load-bearing and easy to get wrong:
//
//  1. Rule numbers renumber on delete and reorder, AND the condition format
//     expression is rewritten in the same step. Letting them drift apart would
//     leave an expression pointing at a rule that no longer exists — the
//     automation then silently matches nothing, with nothing on screen to say
//     why.
//
//  2. Dropdowns are disabled while their options load rather than rendering
//     empty. An empty select looks like "no options exist" and sends admins
//     hunting for a problem that isn't there.
// ------------------------------------------------------------

interface CatalogField {
  key: string;
  label: string;
  type: string;
  options?: string[];
}
interface CatalogGroup {
  key: string;
  label: string;
  fields: CatalogField[];
}
interface OperatorOption {
  value: string;
  label: string;
  takesValue: boolean;
  takesList: boolean;
}
interface Catalog {
  groups: CatalogGroup[];
  events: { value: string; label: string }[];
  operators: OperatorOption[];
  recipientTypes: { value: string; label: string }[];
}

export interface ConditionRuleDraft {
  id: number;
  field: string;
  operator: string;
  value: string;
  relation_with_next: "AND" | "OR";
}

export interface RecipientDraft {
  type: string;
  phone?: string;
  label?: string;
}

export interface ModuleAutomationDraft {
  name: string;
  module: AutomationModule | "";
  event: string;
  templateName: string;
  language: string;
  recipients: RecipientDraft[];
  rules: ConditionRuleDraft[];
  expression: string;
  variables: Record<string, string>;
}

export const EMPTY_DRAFT: ModuleAutomationDraft = {
  name: "",
  module: "",
  event: "",
  templateName: "",
  language: "en",
  recipients: [],
  rules: [],
  expression: "",
  variables: {},
};

interface TemplateOption {
  name: string;
  language: string;
  bodyText: string;
  variableCount: number;
}

export interface ModuleAutomationFormProps {
  draft: ModuleAutomationDraft;
  onChange: (draft: ModuleAutomationDraft) => void;
  templates: TemplateOption[];
  templatesLoading?: boolean;
  /** Employees with no phone saved — a silent-failure warning, not a blocker. */
  unreachableEmployeeCount?: number;
  disabled?: boolean;
}

const MODULES: { value: AutomationModule; label: string }[] = [
  { value: "customer", label: "Customer" },
  { value: "order", label: "Order" },
  { value: "dispatch", label: "Dispatch" },
];

export function ModuleAutomationForm({
  draft,
  onChange,
  templates,
  templatesLoading,
  unreachableEmployeeCount = 0,
  disabled,
}: ModuleAutomationFormProps) {
  const [editingExpression, setEditingExpression] = useState(false);

  const patch = useCallback(
    (next: Partial<ModuleAutomationDraft>) => onChange({ ...draft, ...next }),
    [draft, onChange],
  );

  // ---- Catalog loads when the module changes -----------------------------
  // Keyed by module rather than cleared in a separate synchronous setState, so
  // there is never a render where a stale module's fields are on screen under a
  // newly-chosen module. `catalog` is only read when its key matches.
  // State is written only from the async callbacks, never synchronously inside
  // the effect — a synchronous setState there causes a second render pass on
  // every module change. "Loading" is therefore DERIVED: if the settled result
  // isn't for the module currently selected, we're still fetching it.
  const [settled, setSettled] = useState<{ module: string; data: Catalog | null }>({
    module: "",
    data: null,
  });

  useEffect(() => {
    const moduleKey = draft.module;
    if (!moduleKey) return;

    let cancelled = false;
    fetch(`/api/automations/field-catalog?module=${moduleKey}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Could not load fields"))))
      .then((data: Catalog) => {
        if (!cancelled) setSettled({ module: moduleKey, data });
      })
      .catch(() => {
        if (cancelled) return;
        // Settle with no data so the form stops showing "Loading…" forever;
        // the toast explains why the dropdowns are empty.
        setSettled({ module: moduleKey, data: null });
        toast.error("Could not load the field list. Try again.");
      });

    return () => {
      cancelled = true;
    };
  }, [draft.module]);

  const catalog = settled.module === draft.module ? settled.data : null;
  const catalogLoading = Boolean(draft.module) && settled.module !== draft.module;

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.name === draft.templateName),
    [templates, draft.templateName],
  );

  const allFields = useMemo(
    () => (catalog?.groups ?? []).flatMap((g) => g.fields),
    [catalog],
  );

  const expressionError = useMemo(() => {
    if (draft.rules.length === 0) return null;
    const result = parseConditionExpression(
      draft.expression,
      draft.rules.map((r) => r.id),
    );
    return result.ok ? null : result.error;
  }, [draft.expression, draft.rules]);

  // ---- Rules -------------------------------------------------------------
  // Renumber AND rewrite the expression together. Doing one without the other
  // leaves an expression referencing a rule that no longer exists, and the
  // automation then quietly stops matching.
  function commitRules(rules: ConditionRuleDraft[]) {
    const renumbered = rules.map((r, i) => ({ ...r, id: i + 1 }));
    patch({ rules: renumbered, expression: buildExpressionFromRelations(renumbered) });
  }

  function addRule() {
    commitRules([
      ...draft.rules,
      { id: 0, field: "", operator: "equals", value: "", relation_with_next: "AND" },
    ]);
  }

  function updateRule(index: number, next: Partial<ConditionRuleDraft>) {
    const rules = draft.rules.map((r, i) => (i === index ? { ...r, ...next } : r));
    // A relation change alters the derived expression, so rebuild unless the
    // admin has taken manual control of it.
    if (next.relation_with_next && !editingExpression) {
      commitRules(rules);
      return;
    }
    patch({ rules });
  }

  function removeRule(index: number) {
    commitRules(draft.rules.filter((_, i) => i !== index));
  }

  // ---- Recipients --------------------------------------------------------
  function toggleRecipient(type: string) {
    const exists = draft.recipients.some((r) => r.type === type);
    patch({
      recipients: exists
        ? draft.recipients.filter((r) => r.type !== type)
        : [...draft.recipients, { type }],
    });
  }

  const showEmployeeWarning =
    unreachableEmployeeCount > 0 &&
    draft.recipients.some((r) => r.type === "creator" || r.type === "creator_manager");

  return (
    <div className="space-y-5">
      {/* Name */}
      <Field label="Name" required htmlFor="auto-name">
        <Input
          id="auto-name"
          value={draft.name}
          disabled={disabled}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="Enter name..."
          className="bg-muted border-border"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Module */}
        <Field label="Module" required>
          <Select
            value={draft.module || undefined}
            disabled={disabled}
            onValueChange={(v) =>
              // Changing module invalidates the event and every condition,
              // because the available fields change entirely.
              patch({
                module: (v ?? "") as AutomationModule | "",
                event: "",
                rules: [],
                expression: "",
              })
            }
          >
            <SelectTrigger className="bg-muted border-border">
              <SelectValue placeholder="Select module..." />
            </SelectTrigger>
            <SelectContent>
              {MODULES.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {/* Event — depends on module */}
        <Field label="Event" required>
          <Select
            value={draft.event || undefined}
            disabled={disabled || !draft.module || catalogLoading}
            onValueChange={(v) => patch({ event: v ?? "" })}
          >
            <SelectTrigger className="bg-muted border-border">
              <SelectValue
                placeholder={
                  !draft.module
                    ? "Select a module first"
                    : catalogLoading
                      ? "Loading…"
                      : "Select event..."
                }
              />
            </SelectTrigger>
            <SelectContent>
              {(catalog?.events ?? []).map((e) => (
                <SelectItem key={e.value} value={e.value}>
                  {e.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      {/* Action — a select, not fixed text, so future actions slot in
          without redesigning the form. */}
      <Field label="Action" required>
        <Select value="send_whatsapp" disabled>
          <SelectTrigger className="bg-muted border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="send_whatsapp">Send WhatsApp message</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-muted-foreground mt-1 text-xs">
          More actions (SMS, create activity, update field) come later.
        </p>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Template */}
        <Field label="WhatsApp template" required>
          <Select
            value={draft.templateName || undefined}
            disabled={disabled || templatesLoading || templates.length === 0}
            onValueChange={(v) => {
              const name = v ?? "";
              const t = templates.find((x) => x.name === name);
              patch({ templateName: name, language: t?.language ?? "en", variables: {} });
            }}
          >
            <SelectTrigger className="bg-muted border-border">
              <SelectValue
                placeholder={
                  templatesLoading
                    ? "Loading…"
                    : templates.length === 0
                      ? "No approved templates yet"
                      : "Select template..."
                }
              />
            </SelectTrigger>
            <SelectContent>
              {templates.map((t) => (
                <SelectItem key={t.name} value={t.name}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {templates.length === 0 && !templatesLoading && (
            <p className="mt-1 text-xs text-amber-400">
              WhatsApp needs a Meta-approved template before an automation can send.
              Create one in Settings → Templates.
            </p>
          )}
        </Field>

        {/* Send to */}
        <Field label="Send to" required>
          <div className="bg-muted border-border flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5">
            {(catalog?.recipientTypes ?? []).map((r) => {
              const active = draft.recipients.some((x) => x.type === r.value);
              return (
                <button
                  key={r.value}
                  type="button"
                  disabled={disabled}
                  onClick={() => toggleRecipient(r.value)}
                  className={cn(
                    "rounded px-2 py-0.5 text-xs transition-colors",
                    active
                      ? "bg-primary/20 text-primary border-primary/40 border"
                      : "border-border text-muted-foreground hover:text-foreground border",
                  )}
                >
                  {r.label}
                </button>
              );
            })}
            {!catalog && (
              <span className="text-muted-foreground text-xs">
                {draft.module ? "Loading…" : "Select a module first"}
              </span>
            )}
          </div>
          {showEmployeeWarning && (
            <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-400">
              <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
              {unreachableEmployeeCount} employee
              {unreachableEmployeeCount === 1 ? " has" : "s have"} no phone number saved and
              will not receive this.
            </p>
          )}
        </Field>
      </div>

      {/* Template variables */}
      {selectedTemplate && selectedTemplate.variableCount > 0 && (
        <Field label="Message details">
          <div className="space-y-2">
            {Array.from({ length: selectedTemplate.variableCount }, (_, i) => {
              const slot = String(i + 1);
              return (
                <div key={slot} className="flex items-center gap-2">
                  <span className="text-muted-foreground w-10 shrink-0 text-xs">
                    {`{{${slot}}}`}
                  </span>
                  <Select
                    value={draft.variables[slot] || undefined}
                    disabled={disabled}
                    onValueChange={(v) =>
                      patch({ variables: { ...draft.variables, [slot]: v ?? "" } })
                    }
                  >
                    <SelectTrigger className="bg-muted border-border h-8 text-xs">
                      <SelectValue placeholder="Choose a field..." />
                    </SelectTrigger>
                    <SelectContent>
                      {(catalog?.groups ?? []).map((g) => (
                        <SelectGroupBlock key={g.key} group={g} />
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
        </Field>
      )}

      {/* Conditions */}
      <div className="space-y-2">
        <Label className="text-sm">Condition(s)</Label>
        <div className="border-border overflow-hidden rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted/60 text-muted-foreground">
              <tr>
                <th className="w-8" />
                <th className="px-2 py-2 text-left font-medium">Field</th>
                <th className="px-2 py-2 text-left font-medium">Operator</th>
                <th className="px-2 py-2 text-left font-medium">Value</th>
                <th className="px-2 py-2 text-left font-medium">Relation with next rule</th>
                <th className="px-2 py-2 text-left font-medium">Rule</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {draft.rules.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-muted-foreground px-3 py-4 text-center">
                    No conditions — this automation runs for every {draft.module || "record"}.
                  </td>
                </tr>
              )}
              {draft.rules.map((rule, index) => {
                const op = catalog?.operators.find((o) => o.value === rule.operator);
                const field = allFields.find((f) => f.key === rule.field);
                return (
                  <tr key={rule.id} className="border-border border-t">
                    <td className="px-1 text-center">
                      <GripVertical className="text-muted-foreground/50 mx-auto h-3.5 w-3.5" />
                    </td>
                    <td className="px-2 py-1.5">
                      <Select
                        value={rule.field || undefined}
                        disabled={disabled || !catalog}
                        onValueChange={(v) => updateRule(index, { field: v ?? "", value: "" })}
                      >
                        <SelectTrigger className="bg-muted border-border h-8 text-xs">
                          <SelectValue placeholder="Select field..." />
                        </SelectTrigger>
                        <SelectContent>
                          {(catalog?.groups ?? []).map((g) => (
                            <SelectGroupBlock key={g.key} group={g} />
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-2 py-1.5">
                      <Select
                        value={rule.operator}
                        disabled={disabled || !catalog}
                        onValueChange={(v) => updateRule(index, { operator: v ?? "equals", value: "" })}
                      >
                        <SelectTrigger className="bg-muted border-border h-8 text-xs">
                          <SelectValue placeholder="Select..." />
                        </SelectTrigger>
                        <SelectContent>
                          {(catalog?.operators ?? []).map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-2 py-1.5">
                      {op?.takesValue === false ? (
                        <span className="text-muted-foreground">—</span>
                      ) : field?.options?.length ? (
                        <Select
                          value={rule.value || undefined}
                          disabled={disabled}
                          onValueChange={(v) => updateRule(index, { value: v ?? "" })}
                        >
                          <SelectTrigger className="bg-muted border-border h-8 text-xs">
                            <SelectValue placeholder="Select..." />
                          </SelectTrigger>
                          <SelectContent>
                            {field.options.map((o) => (
                              <SelectItem key={o} value={o}>
                                {o}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          value={rule.value}
                          disabled={disabled}
                          onChange={(e) => updateRule(index, { value: e.target.value })}
                          placeholder={op?.takesList ? "Rajkot, Morbi" : "Value"}
                          className="bg-muted border-border h-8 text-xs"
                        />
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <Select
                        value={rule.relation_with_next}
                        disabled={disabled || index === draft.rules.length - 1}
                        onValueChange={(v) =>
                          updateRule(index, { relation_with_next: (v ?? "AND") as "AND" | "OR" })
                        }
                      >
                        <SelectTrigger className="bg-muted border-border h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="AND">AND</SelectItem>
                          <SelectItem value="OR">OR</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="text-muted-foreground px-2 py-1.5">{rule.id}</td>
                    <td className="px-1">
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => removeRule(index)}
                        aria-label={`Delete rule ${rule.id}`}
                        className="text-muted-foreground hover:text-red-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || !draft.module}
          onClick={addRule}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add rule
        </Button>
      </div>

      {/* Condition format */}
      {draft.rules.length > 0 && (
        <div className="bg-muted/40 border-border rounded-md border px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <Label className="text-muted-foreground text-[11px] tracking-wide uppercase">
                Condition format
              </Label>
              {editingExpression ? (
                <Input
                  autoFocus
                  value={draft.expression}
                  disabled={disabled}
                  onChange={(e) => patch({ expression: e.target.value })}
                  onBlur={() => setEditingExpression(false)}
                  placeholder="1 AND (2 OR 3)"
                  className="bg-background border-border mt-1 h-8 font-mono text-xs"
                />
              ) : (
                <p className="text-foreground mt-0.5 font-mono text-sm">
                  {draft.expression || "—"}
                </p>
              )}
            </div>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setEditingExpression((v) => !v)}
              aria-label="Edit condition format"
              className="text-muted-foreground hover:text-foreground shrink-0"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </div>
          {expressionError ? (
            <p className="mt-1.5 text-xs text-red-400">{expressionError}</p>
          ) : (
            <p className="text-muted-foreground mt-1.5 text-xs">
              Use brackets to group rules, e.g. 1 AND (2 OR 3).
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function SelectGroupBlock({ group }: { group: CatalogGroup }) {
  return (
    <>
      <div className="text-muted-foreground px-2 py-1 text-[11px] font-medium tracking-wide uppercase">
        {group.label}
      </div>
      {group.fields.map((f) => (
        <SelectItem key={f.key} value={f.key}>
          {f.label}
        </SelectItem>
      ))}
    </>
  );
}

function Field({
  label,
  required,
  htmlFor,
  children,
}: {
  label: string;
  required?: boolean;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-sm">
        {label} {required && <span className="text-red-400">*</span>}
      </Label>
      {children}
    </div>
  );
}

export function FormLoading() {
  return (
    <div className="text-muted-foreground flex items-center gap-2 py-8 text-sm">
      <Loader2 className="h-4 w-4 animate-spin" />
      Loading…
    </div>
  );
}
