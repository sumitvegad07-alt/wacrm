'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import type { CustomField } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, Trash2, Edit2, Check, X } from 'lucide-react';

interface CustomFieldsManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Dialog wrapper around {@link CustomFieldsPanel}, used on the Contacts page.
 * The same panel is rendered inline under Settings → Custom Fields, so the
 * editing UI lives in one place. Radix unmounts the dialog content on close,
 * so the panel remounts (and refetches) on each open.
 */
export function CustomFieldsManager({
  open,
  onOpenChange,
}: CustomFieldsManagerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">Custom fields</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Define extra contact fields (e.g. ZIP code, lead source). They
            appear on every contact and in the “Update Contact Field” automation
            action.
          </DialogDescription>
        </DialogHeader>
        <CustomFieldsPanel />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Create / rename / delete account-wide custom contact field definitions.
 * Per-contact values are edited elsewhere (contact detail → Custom Fields);
 * this only manages the field catalogue. Admin+ gated by the caller — the
 * `custom_fields` RLS also rejects non-admin writes as defense in depth.
 */
export function CustomFieldsPanel() {
  const supabase = createClient();
  const { user, accountId } = useAuth();

  const [fields, setFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('text');
  const [newModule, setNewModule] = useState<'contact'|'deal'|'task'|'product'|'lead'>('contact');
  const [newSourceType, setNewSourceType] = useState<'static'|'module'>('static');
  const [newSourceModule, setNewSourceModule] = useState<'product'|'user'|'contact'|'lead'|'deal'>('product');
  const [newChoices, setNewChoices] = useState<string[]>(['']);
  
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchFields = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const { data } = await supabase
      .from('custom_fields')
      .select('*')
      .order('field_name');
    setFields((data as CustomField[] | null) ?? []);
    setLoading(false);
  }, [supabase, accountId]);

  useEffect(() => {
    if (accountId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchFields();
    }
  }, [accountId, fetchFields]);

  function isDuplicate(name: string, module: string, exceptId?: string): boolean {
    const lower = name.toLowerCase();
    return fields.some(
      (f) => f.id !== exceptId && f.field_name.toLowerCase() === lower && f.module_name === module
    );
  }

  const needsChoices = ['dropdown', 'radio', 'multi-select'].includes(newType);

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    if (!accountId || !user) {
      toast.error('Your profile is not linked to an account.');
      return;
    }
    if (isDuplicate(name, newModule)) {
      toast.error(`A field named "${name}" already exists for the ${newModule} module.`);
      return;
    }

    let options = null;
    if (needsChoices && newSourceType === 'static') {
      const validChoices = newChoices.map(c => c.trim()).filter(Boolean);
      if (validChoices.length === 0) {
        toast.error('Please provide at least one choice for this field type.');
        return;
      }
      options = { choices: validChoices };
    }

    setCreating(true);
    const { error } = await supabase.from('custom_fields').insert({
      field_name: name,
      field_type: newType,
      module_name: newModule,
      field_options: options,
      source_type: needsChoices ? newSourceType : 'static',
      source_module: (needsChoices && newSourceType === 'module') ? newSourceModule : null,
      user_id: user.id,
      account_id: accountId,
    });
    setCreating(false);

    if (error) {
      toast.error('Could not create field. You may not have permission.');
      return;
    }
    toast.success(`Created "${name}".`);
    setNewName('');
    setNewType('text');
    setNewModule('contact');
    setNewSourceType('static');
    setNewSourceModule('product');
    setNewChoices(['']);
    await fetchFields();
  }

  async function handleRename(
    field: CustomField,
    nextName: string
  ): Promise<boolean> {
    const name = nextName.trim();
    if (!name || name === field.field_name) return true;
    if (isDuplicate(name, field.module_name, field.id)) {
      toast.error(`A field named "${name}" already exists for the ${field.module_name} module.`);
      return false;
    }
    setBusyId(field.id);
    const { error } = await supabase
      .from('custom_fields')
      .update({ field_name: name })
      .eq('id', field.id);
    setBusyId(null);
    if (error) {
      toast.error('Could not rename field.');
      return false;
    }
    await fetchFields();
    return true;
  }

  async function handleDelete(field: CustomField) {
    if (
      !window.confirm(
        `Delete "${field.field_name}"? This also removes its stored value on every contact. This cannot be undone.`
      )
    ) {
      return;
    }
    setBusyId(field.id);
    const { error } = await supabase
      .from('custom_fields')
      .delete()
      .eq('id', field.id);
    setBusyId(null);
    if (error) {
      toast.error('Could not delete field.');
      return;
    }
    toast.success(`Deleted "${field.field_name}".`);
    await fetchFields();
  }

  return (
    <div className="space-y-4">
      {/* Create */}
      <div className="space-y-3 bg-muted/30 p-3 rounded-lg border border-border">
        <div className="flex items-center gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !needsChoices) {
                e.preventDefault();
                void handleCreate();
              }
            }}
            placeholder="New field name…"
            className="bg-background text-foreground flex-1"
          />
          <select
            value={newModule}
            onChange={(e) => setNewModule(e.target.value as 'contact'|'deal'|'task'|'product'|'lead')}
            className="h-9 rounded-md border border-border bg-background px-2.5 text-sm outline-none w-28 text-muted-foreground"
          >
            <option value="contact">Customer</option>
            <option value="lead">Lead</option>
            <option value="deal">Deal</option>
            <option value="task">Task</option>
            <option value="product">Product</option>
          </select>
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-2.5 text-sm outline-none w-36"
          >
            <option value="text">Text (Single line)</option>
            <option value="number">Number</option>
            <option value="email">Email</option>
            <option value="phone">Phone</option>
            <option value="date">Date</option>
            <option value="checkbox">Checkbox (True/False)</option>
            <option value="dropdown">Dropdown (Single select)</option>
            <option value="radio">Radio (Single select)</option>
            <option value="multi-select">Multi-select</option>
            <option value="attachment">Attachment</option>
          </select>
          <Button
            onClick={handleCreate}
            disabled={creating || !newName.trim()}
            className="bg-primary hover:bg-primary/90 text-primary-foreground shrink-0"
          >
            {creating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Add
          </Button>
        </div>

        {needsChoices && (
          <div className="space-y-4 pl-2 border-l-2 border-border/50">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input 
                  type="radio" 
                  checked={newSourceType === 'static'}
                  onChange={() => setNewSourceType('static')}
                  className="accent-primary"
                />
                Static List
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input 
                  type="radio" 
                  checked={newSourceType === 'module'}
                  onChange={() => setNewSourceType('module')}
                  className="accent-primary"
                />
                From Module
              </label>
            </div>

            {newSourceType === 'static' ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Options</p>
                {newChoices.map((choice, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={choice}
                      onChange={(e) => {
                        const next = [...newChoices];
                        next[i] = e.target.value;
                        setNewChoices(next);
                      }}
                      placeholder={`Option ${i + 1}`}
                      className="h-8 bg-background text-sm flex-1"
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setNewChoices(newChoices.filter((_, idx) => idx !== i))}
                      disabled={newChoices.length === 1}
                      className="text-muted-foreground hover:text-red-400"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setNewChoices([...newChoices, ''])}
                  className="h-8 text-xs bg-background"
                >
                  <Plus className="size-3.5 mr-1" /> Add Option
                </Button>
              </div>
            ) : (
              <div className="space-y-2 max-w-sm">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Source Module</p>
                <select
                  value={newSourceModule}
                  onChange={(e) => setNewSourceModule(e.target.value as any)}
                  className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm outline-none"
                >
                  <option value="product">Products</option>
                  <option value="user">Users (Team)</option>
                  <option value="contact">Customers</option>
                  <option value="lead">Leads</option>
                  <option value="deal">Deals</option>
                </select>
                <p className="text-xs text-muted-foreground mt-1">
                  The dropdown options will automatically sync with all active records in this module.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* List */}
      <div className="max-h-72 overflow-y-auto rounded-md border border-border">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading…
          </div>
        ) : fields.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No custom fields yet.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {fields.map((field) => (
              <FieldRow
                key={field.id}
                field={field}
                busy={busyId === field.id}
                onRename={handleRename}
                onDelete={handleDelete}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** A single editable row. Controlled local state lets us commit on blur /
 *  Enter and cleanly revert to the last saved name when a rename fails. */
function FieldRow({
  field,
  busy,
  onRename,
  onDelete,
}: {
  field: CustomField;
  busy: boolean;
  onRename: (field: CustomField, name: string) => Promise<boolean>;
  onDelete: (field: CustomField) => void;
}) {
  const [name, setName] = useState(field.field_name);
  const [isEditing, setIsEditing] = useState(false);

  async function commit() {
    if (name.trim() === field.field_name) {
      setName(field.field_name); // normalise any whitespace-only edit
      setIsEditing(false);
      return;
    }
    const ok = await onRename(field, name);
    if (!ok) setName(field.field_name);
    else setIsEditing(false);
  }

  return (
    <li className="flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors">
      {isEditing ? (
        <>
          <Input
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commit();
              if (e.key === 'Escape') {
                setName(field.field_name);
                setIsEditing(false);
              }
            }}
            autoFocus
            className="h-8 flex-1 min-w-[120px]"
          />
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            onClick={() => void commit()}
            className="shrink-0 text-green-500 hover:text-green-600"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            onClick={() => {
              setName(field.field_name);
              setIsEditing(false);
            }}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </Button>
        </>
      ) : (
        <>
          <span className="flex-1 text-sm font-medium">{field.field_name}</span>
          <Badge variant="outline" className="shrink-0 font-normal uppercase text-[10px] tracking-wider bg-card">
            {field.module_name || 'contact'}
          </Badge>
          <Badge variant="secondary" className="shrink-0 font-normal capitalize text-xs">
            {field.field_type}
          </Badge>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            onClick={() => setIsEditing(true)}
            title="Edit field name"
            className="shrink-0 text-muted-foreground hover:text-primary"
          >
            <Edit2 className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            onClick={() => onDelete(field)}
            title="Delete field"
            className="shrink-0 text-muted-foreground hover:text-red-400"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
          </Button>
        </>
      )}
    </li>
  );
}
