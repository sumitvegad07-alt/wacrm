"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, MoreVertical, Copy, Trash2, Pencil, LayoutTemplate, Loader2, UserPlus, Users } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { SettingsPanelHead } from "../settings-panel-head";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  DOCUMENT_MODULES,
  MODULE_LABELS,
  buildDefaultConfig,
  type DocumentModule,
} from "@/lib/document-templates/schema";
import {
  listTemplates,
  createTemplate,
  deleteTemplate,
  setDefaultTemplate,
  listAssignableUsers,
  assignTemplate,
  unassignTemplate,
  type DocumentTemplate,
  type AccountUser,
} from "@/lib/document-templates/repository";

/**
 * Only document types that exist in the product and already have a print route. The
 * original mockup also listed "Estimate" (the product calls it Quotation) and "Outstanding"
 * (a statement of account, which is a document still to be built — not a template awaiting
 * a backend).
 */
const MODULES = DOCUMENT_MODULES.map((id) => ({ id, label: MODULE_LABELS[id] }));

export function DocumentTemplatesPanel() {
  const router = useRouter();
  const supabase = createClient();
  const { accountId, user } = useAuth();

  const [activeModule, setActiveModule] = useState<DocumentModule>(MODULES[0].id);
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [users, setUsers] = useState<AccountUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [assignFor, setAssignFor] = useState<DocumentTemplate | null>(null);
  const [assignSaving, setAssignSaving] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      let tpls = await listTemplates(supabase, accountId, activeModule);

      // Every module starts with a ready-made Default rather than an empty screen. Created
      // on first view instead of by a migration, because the built-in config is defined in
      // TypeScript and a seeded row would drift the moment those defaults changed. Racing
      // two tabs is harmless — the unique name index rejects the second, and we just reload.
      if (tpls.length === 0) {
        try {
          await createTemplate(
            supabase,
            accountId,
            activeModule,
            'Default',
            buildDefaultConfig(activeModule),
            user?.id
          );
        } catch {
          // Someone else created it first, or this member cannot insert. Either way, re-read.
        }
        tpls = await listTemplates(supabase, accountId, activeModule);
      }

      setTemplates(tpls);
      setUsers(await listAssignableUsers(supabase, accountId, activeModule));
    } catch (err: any) {
      toast.error(`Could not load templates: ${err.message}`);
      setTemplates([]);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [accountId, activeModule, supabase, user?.id]);

  const assigneesOf = (templateId: string) =>
    users.filter((u) => u.assignedTemplateId === templateId);

  const handleToggleAssignment = async (user: AccountUser, on: boolean) => {
    if (!assignFor || !accountId) return;
    setAssignSaving(true);
    try {
      if (on) {
        await assignTemplate(supabase, assignFor.id, user.userId, accountId, activeModule);
      } else {
        await unassignTemplate(supabase, assignFor.id, user.userId);
      }
      setUsers(await listAssignableUsers(supabase, accountId, activeModule));
    } catch (err: any) {
      toast.error(`Could not update assignment: ${err.message}`);
    } finally {
      setAssignSaving(false);
    }
  };

  useEffect(() => {
    load();
  }, [load]);

  const handleDuplicate = async (tpl: DocumentTemplate) => {
    if (!accountId) return;
    setBusyId(tpl.id);
    try {
      // Names are unique per module, so a straight "Copy of X" collides the second time.
      const existing = new Set(templates.map((t) => t.name.trim().toLowerCase()));
      let name = `Copy of ${tpl.name}`;
      let n = 2;
      while (existing.has(name.trim().toLowerCase())) name = `Copy of ${tpl.name} (${n++})`;

      await createTemplate(supabase, accountId, activeModule, name, tpl.config, user?.id);
      toast.success(`"${name}" created.`);
      await load();
    } catch (err: any) {
      toast.error(`Could not duplicate: ${err.message}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleMakeDefault = async (tpl: DocumentTemplate) => {
    setBusyId(tpl.id);
    try {
      await setDefaultTemplate(supabase, tpl.id);
      toast.success(`"${tpl.name}" is now the default ${MODULE_LABELS[activeModule]} template.`);
      await load();
    } catch (err: any) {
      toast.error(`Could not set default: ${err.message}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (tpl: DocumentTemplate) => {
    if (tpl.isDefault) {
      // Deleting the default would leave every future document with no layout, so it has to
      // be handed over first rather than silently reassigned.
      toast.error("This is the default template. Make another one the default first.");
      return;
    }
    if (!window.confirm(`Delete "${tpl.name}"? This cannot be undone.`)) return;

    setBusyId(tpl.id);
    try {
      await deleteTemplate(supabase, tpl.id);
      toast.success(`"${tpl.name}" deleted.`);
      await load();
    } catch (err: any) {
      toast.error(`Could not delete: ${err.message}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="w-full animate-in fade-in-50 duration-200 flex flex-col h-[calc(100vh-120px)]">
      <SettingsPanelHead
        title="Document Templates"
        description="Configure PDF templates for transactions like Orders, Quotations, Dispatches and Payments."
        action={
          <Button onClick={() => router.push(`/settings/document-templates/new?module=${activeModule}`)}>
            <Plus className="mr-2 size-4" /> New Template
          </Button>
        }
      />

      <div className="flex flex-1 overflow-hidden border rounded-xl bg-card">
        {/* Left Sidebar: Modules */}
        <div className="w-64 border-r bg-muted/30 overflow-y-auto">
          <div className="p-3 font-semibold text-sm border-b">Module</div>
          <div className="p-2 space-y-1">
            {MODULES.map((mod) => (
              <button
                key={mod.id}
                onClick={() => setActiveModule(mod.id)}
                className={cn(
                  "w-full flex items-center px-3 py-2.5 text-sm rounded-md transition-colors text-left",
                  activeModule === mod.id
                    ? "bg-primary text-primary-foreground font-medium shadow-sm"
                    : "hover:bg-muted text-muted-foreground hover:text-foreground"
                )}
              >
                {mod.label}
              </button>
            ))}
          </div>
        </div>

        {/* Right Area: Templates Grid */}
        <div className="flex-1 overflow-y-auto bg-muted/10 p-6">
          <div className="font-semibold text-sm mb-4">Templates</div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : templates.length === 0 ? (
            // Only reachable when the automatic Default could not be created — e.g. a member
            // without insert rights. Says so rather than looking broken.
            <div className="text-center py-12 text-muted-foreground text-sm border-2 border-dashed rounded-xl">
              No templates for {MODULE_LABELS[activeModule]}.
              <div className="mt-1 text-xs">
                Documents print with the built-in layout until one is created.
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {templates.map((tpl) => (
                <div key={tpl.id} className="group flex flex-col">
                  {/* Template Card */}
                  <Card className="relative overflow-hidden aspect-[1/1.4] flex flex-col bg-white">
                    {tpl.isDefault && (
                      <div className="absolute top-4 -left-8 -rotate-45 bg-emerald-500 text-white text-[10px] font-bold py-1 w-32 text-center shadow-sm z-10">
                        DEFAULT
                      </div>
                    )}

                    {busyId === tpl.id && (
                      <div className="absolute inset-0 z-20 bg-white/70 flex items-center justify-center">
                        <Loader2 className="size-6 animate-spin text-muted-foreground" />
                      </div>
                    )}

                    <div className="absolute top-2 right-2 z-10">
                      <DropdownMenu>
                        <DropdownMenuTrigger className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium h-8 w-8 bg-blue-600 hover:bg-blue-700 shadow-sm text-white outline-none focus:outline-none focus:ring-0">
                          <MoreVertical className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem onClick={() => router.push(`/settings/document-templates/${tpl.id}/edit`)}>
                            <Pencil className="mr-2 size-4" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleDuplicate(tpl)}>
                            <Copy className="mr-2 size-4" /> Clone
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setAssignFor(tpl)}>
                            <UserPlus className="mr-2 size-4" /> Assign Users
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleDelete(tpl)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="mr-2 size-4" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    <CardContent className="p-0 flex-1 flex flex-col">
                      <button
                        type="button"
                        onClick={() => router.push(`/settings/document-templates/${tpl.id}/edit`)}
                        className="flex-1 bg-muted/20 flex items-center justify-center p-4 w-full"
                      >
                        <div className="w-full h-full border border-dashed border-border flex flex-col items-center justify-center text-muted-foreground/50">
                          <LayoutTemplate className="size-12 mb-2 stroke-[1]" />
                          <span className="text-xs">Preview</span>
                        </div>
                      </button>

                      {/* Always visible. These were hover-only, which made Clone and Assign
                          effectively undiscoverable — and invisible entirely on a touch
                          screen, where there is no hover at all. */}
                      <div className="p-2 border-t bg-muted/10 space-y-1.5">
                        <div className="grid grid-cols-2 gap-1.5">
                          <Button
                            variant="outline"
                            onClick={() => handleDuplicate(tpl)}
                            className="h-8 text-xs font-medium"
                          >
                            <Copy className="mr-1.5 size-3.5" /> Clone
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => setAssignFor(tpl)}
                            className="h-8 text-xs font-medium"
                          >
                            <UserPlus className="mr-1.5 size-3.5" /> Assign
                          </Button>
                        </div>
                        {!tpl.isDefault && (
                          <Button
                            variant="default"
                            onClick={() => handleMakeDefault(tpl)}
                            className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-bold h-8 text-xs"
                          >
                            MAKE DEFAULT
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Template Name & Status */}
                  <div className="mt-2 flex items-center justify-between px-1 gap-2">
                    <span className="text-sm font-medium text-foreground truncate">{tpl.name}</span>
                    {assigneesOf(tpl.id).length > 0 && (
                      <span
                        className="flex items-center gap-1 text-xs text-muted-foreground shrink-0"
                        title={assigneesOf(tpl.id).map((u) => u.name).join(', ')}
                      >
                        <Users className="size-3" />
                        {assigneesOf(tpl.id).length}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Dialog open={assignFor !== null} onOpenChange={(open) => !open && setAssignFor(null)}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Assign “{assignFor?.name}”</DialogTitle>
            <DialogDescription>
              Assigned users print {MODULE_LABELS[activeModule]} documents with this template,
              and are the only ones who can edit it. Admins can always edit. Everyone else
              keeps the account default.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[320px] overflow-y-auto space-y-1 py-2">
            {users.length === 0 ? (
              <p className="text-sm text-muted-foreground">No users in this account.</p>
            ) : (
              users.map((u) => {
                const mine = u.assignedTemplateId === assignFor?.id;
                const heldElsewhere = !mine && u.assignedTemplateId !== null;
                return (
                  <label
                    key={u.userId}
                    className="flex items-start gap-3 rounded-md px-2 py-2 hover:bg-muted cursor-pointer"
                  >
                    <Checkbox
                      checked={mine}
                      disabled={assignSaving}
                      onCheckedChange={(c) => handleToggleAssignment(u, !!c)}
                      className="mt-0.5"
                    />
                    <span className="text-sm">
                      {u.name}
                      {heldElsewhere && (
                        // A user holds one template per module, so ticking this box moves
                        // them. Better to say so than to let the save fail on a constraint.
                        <span className="block text-xs text-muted-foreground">
                          Currently on “{u.assignedTemplateName}” — assigning moves them here
                        </span>
                      )}
                    </span>
                  </label>
                );
              })
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignFor(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
