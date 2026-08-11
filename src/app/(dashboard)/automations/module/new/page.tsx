"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Eye, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { GatedButton } from "@/components/ui/gated-button";
import { useAuth } from "@/hooks/use-auth";
import {
  EMPTY_DRAFT,
  ModuleAutomationForm,
  type ModuleAutomationDraft,
} from "@/components/automations/module-automation-form";
import { AutomationPreviewDialog } from "@/components/automations/automation-preview-dialog";

interface TemplateOption {
  name: string;
  language: string;
  bodyText: string;
  variableCount: number;
}

/**
 * Create a business-event automation.
 *
 * Separate route from /automations/new, which builds the older WhatsApp-trigger
 * automations with the multi-step branching builder. These are a different
 * shape — one module event, one message — and folding them into that builder
 * would make both harder to use.
 */
export default function NewModuleAutomationPage() {
  const router = useRouter();
  const { accountId, isModuleEnabled } = useAuth();

  const [draft, setDraft] = useState<ModuleAutomationDraft>(EMPTY_DRAFT);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [unreachableEmployees, setUnreachableEmployees] = useState(0);
  const [saving, setSaving] = useState(false);
  const [previewFor, setPreviewFor] = useState<string | null>(null);

  const whatsappEnabled = isModuleEnabled("whatsapp");

  // Templates and the reachability count come from the catalog endpoint, which
  // is also what the form uses — one round trip, one place enforcing tenancy.
  useEffect(() => {
    if (!accountId || !draft.module) {
      setTemplatesLoading(false);
      return;
    }
    let cancelled = false;

    void (async () => {
      const res = await fetch(`/api/automations/field-catalog?module=${draft.module}`);
      if (cancelled) return;
      if (!res.ok) {
        setTemplatesLoading(false);
        return;
      }
      const body = (await res.json()) as {
        templates: TemplateOption[];
        unreachableEmployees: number;
      };
      if (cancelled) return;
      setTemplates(body.templates ?? []);
      setUnreachableEmployees(body.unreachableEmployees ?? 0);
      setTemplatesLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [accountId, draft.module]);

  const validationError = useCallback((): string | null => {
    if (!draft.name.trim()) return "Give the automation a name.";
    if (!draft.module) return "Choose a module.";
    if (!draft.event) return "Choose an event.";
    if (!draft.templateName) return "Choose a WhatsApp template.";
    if (draft.recipients.length === 0) return "Choose at least one recipient.";
    for (const rule of draft.rules) {
      if (!rule.field) return `Rule ${rule.id} has no field selected.`;
      if (!rule.operator) return `Rule ${rule.id} has no operator selected.`;
    }
    return null;
  }, [draft]);

  async function save(activate: boolean) {
    // Drafts are allowed to be incomplete, matching the existing builder — but
    // activating something broken just produces failed runs nobody reads.
    if (activate) {
      const problem = validationError();
      if (problem) {
        toast.error(problem);
        return;
      }
    }
    if (!draft.name.trim()) {
      toast.error("Give the automation a name.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          trigger_type: draft.event,
          trigger_config: {
            module: draft.module,
            conditions: {
              rules: draft.rules.map((r) => ({
                id: r.id,
                field: r.field,
                operator: r.operator,
                value: r.value,
                relation_with_next: r.relation_with_next,
              })),
              expression: draft.expression,
            },
          },
          is_active: activate,
          steps: [
            {
              index: 0,
              step_type: "send_template",
              step_config: {
                template_name: draft.templateName,
                language: draft.language,
                variables: draft.variables,
                recipients: draft.recipients,
              },
              branch: null,
              parent_index: null,
            },
          ],
        }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body?.error ?? "Could not save the automation.");
        return;
      }

      toast.success(activate ? "Automation is live." : "Saved as a draft.");
      const newId = body?.automation?.id as string | undefined;
      if (newId && !activate) {
        // Stay put so the admin can run Preview against the saved automation.
        setPreviewFor(newId);
        return;
      }
      router.push("/automations");
    } finally {
      setSaving(false);
    }
  }

  if (!whatsappEnabled) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-foreground text-lg font-semibold">WhatsApp is switched off</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Automations send WhatsApp messages, so the WhatsApp module needs to be enabled for
          this organisation before you can create one.
        </p>
        <Button variant="outline" className="mt-6" onClick={() => router.push("/automations")}>
          Back to automations
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push("/automations")}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        <div>
          <h1 className="text-foreground text-lg font-semibold">Add Automation</h1>
          <p className="text-muted-foreground text-xs">
            Send a WhatsApp message automatically when something happens in your business.
          </p>
        </div>
      </div>

      <ModuleAutomationForm
        draft={draft}
        onChange={setDraft}
        templates={templates}
        templatesLoading={templatesLoading}
        unreachableEmployeeCount={unreachableEmployees}
        disabled={saving}
      />

      <div className="border-border mt-8 flex items-center justify-end gap-2 border-t pt-4">
        {previewFor && (
          <Button variant="outline" onClick={() => setPreviewFor(previewFor)} disabled={saving}>
            <Eye className="mr-1.5 h-4 w-4" />
            Preview
          </Button>
        )}
        <Button variant="outline" onClick={() => save(false)} disabled={saving}>
          {saving ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-1.5 h-4 w-4" />
          )}
          Save as draft
        </Button>
        <GatedButton onClick={() => save(true)} disabled={saving}>
          Save &amp; activate
        </GatedButton>
      </div>

      {previewFor && (
        <AutomationPreviewDialog
          automationId={previewFor}
          module={draft.module || "customer"}
          open
          onOpenChange={(open) => {
            if (!open) setPreviewFor(null);
          }}
        />
      )}
    </div>
  );
}
