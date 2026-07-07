'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { CustomField } from '@/types';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, X } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useEffect } from 'react';
import { SearchableSelect } from '@/components/ui/searchable-select';

interface CustomFieldInputProps {
  field: CustomField;
  value: string;
  onChange: (val: string) => void;
}

export function CustomFieldInput({ field, value, onChange }: CustomFieldInputProps) {
  const [uploading, setUploading] = useState(false);
  const [dynamicOptions, setDynamicOptions] = useState<{label: string, value: string}[]>([]);
  const [loadingDynamic, setLoadingDynamic] = useState(false);
  
  const supabase = createClient();
  const { account } = useAuth();

  const options = field.field_options as { choices?: string[] } | undefined;
  
  // Calculate final choices: either dynamic options or static choices
  let choices = options?.choices || [];
  if (field.source_type === 'module' && dynamicOptions.length > 0) {
    choices = dynamicOptions.map(o => o.label);
  }

  useEffect(() => {
    async function loadDynamicOptions() {
      if (field.source_type !== 'module' || !field.source_module || !account) return;
      
      setLoadingDynamic(true);
      let tableName = field.source_module;
      if (tableName === 'user') tableName = 'profiles';
      else if (!tableName.endsWith('s')) tableName += 's'; // e.g. product -> products, lead -> leads

      let query = supabase.from(tableName).select('*');
      
      // Profiles doesn't use account_id for tenancy isolation in this setup usually, but others do
      if (tableName !== 'profiles') {
        query = query.eq('account_id', account.id);
      }
      
      const { data, error } = await query;
      
      if (!error && data) {
        const mapped = data.map((row: any) => {
          let label = row.name || row.title || row.full_name || 'Unknown';
          return { label, value: row.id };
        });
        setDynamicOptions(mapped);
      }
      setLoadingDynamic(false);
    }
    
    loadDynamicOptions();
  }, [field.source_type, field.source_module, account, supabase]);

  if (field.field_type === 'checkbox') {
    return (
      <div className="flex items-center gap-2 mt-1">
        <Checkbox 
          checked={value === 'true'} 
          onCheckedChange={(checked) => onChange(checked ? 'true' : 'false')}
        />
        <span className="text-sm text-foreground">Yes</span>
      </div>
    );
  }

  if (field.field_type === 'dropdown') {
    return (
      <div className="relative">
        <SearchableSelect
          value={value}
          onChange={(val) => onChange(val)}
          options={choices.map(c => ({ label: c, value: c }))}
          placeholder={`Select ${field.field_name}...`}
          searchPlaceholder="Search options..."
          emptyMessage="No options available"
        />
        {loadingDynamic && (
          <Loader2 className="size-4 animate-spin text-muted-foreground absolute right-8 top-2.5 pointer-events-none" />
        )}
      </div>
    );
  }

  if (field.field_type === 'radio') {
    if (loadingDynamic) return <div className="text-sm text-muted-foreground flex items-center gap-2 mt-1"><Loader2 className="size-3 animate-spin" /> Loading options...</div>;
    return (
      <div className="space-y-2 mt-1">
        {choices.map(c => (
          <label key={c} className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input 
              type="radio" 
              name={`radio-${field.id}`} 
              value={c} 
              checked={value === c}
              onChange={(e) => onChange(e.target.value)}
              className="accent-primary"
            />
            {c}
          </label>
        ))}
      </div>
    );
  }

  if (field.field_type === 'multi-select') {
    if (loadingDynamic) return <div className="text-sm text-muted-foreground flex items-center gap-2 mt-1"><Loader2 className="size-3 animate-spin" /> Loading options...</div>;
    const selectedVals = value ? value.split(',').map(s => s.trim()) : [];
    return (
      <div className="space-y-2 mt-1 p-2 border border-border rounded-md bg-muted/30 max-h-48 overflow-y-auto">
        {choices.map(c => (
          <label key={c} className="flex items-center gap-2 text-sm text-foreground cursor-pointer hover:bg-muted/50 p-1 rounded-sm">
            <Checkbox 
              checked={selectedVals.includes(c)}
              onCheckedChange={(checked) => {
                let next = [...selectedVals];
                if (checked) next.push(c);
                else next = next.filter(v => v !== c);
                onChange(next.join(', '));
              }}
            />
            {c}
          </label>
        ))}
      </div>
    );
  }

  if (field.field_type === 'attachment') {
    return (
      <div className="flex items-center gap-2">
        {value ? (
          <div className="flex items-center gap-2 flex-1 border border-border rounded-md px-3 py-1.5 bg-muted/50">
            <a href={value} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline truncate max-w-[200px]">
              View Attachment
            </a>
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => onChange('')} className="text-muted-foreground hover:text-red-400 ml-auto">
              <X className="size-3.5" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 w-full">
            <Input 
              type="file" 
              disabled={uploading}
              className="bg-muted border-border text-foreground h-9 text-sm file:mr-2 file:py-1 file:px-2 file:border-0 file:text-xs file:bg-primary/20 file:text-primary file:rounded cursor-pointer"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setUploading(true);
                const fileExt = file.name.split('.').pop();
                const fileName = `${Math.random().toString(36).substring(2)}-${Date.now()}.${fileExt}`;
                const { data, error } = await supabase.storage.from('custom-field-attachments').upload(fileName, file);
                
                if (error) {
                  toast.error('Failed to upload attachment. Ensure the "custom-field-attachments" bucket exists.');
                } else {
                  const { data: { publicUrl } } = supabase.storage.from('custom-field-attachments').getPublicUrl(fileName);
                  onChange(publicUrl);
                }
                setUploading(false);
              }}
            />
            {uploading && <Loader2 className="size-4 animate-spin text-muted-foreground shrink-0" />}
          </div>
        )}
      </div>
    );
  }

  let inputType = 'text';
  if (field.field_type === 'number') inputType = 'number';
  if (field.field_type === 'email') inputType = 'email';
  if (field.field_type === 'phone') inputType = 'tel';
  if (field.field_type === 'date') inputType = 'date';

  return (
    <Input
      type={inputType}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={`Enter ${field.field_name}...`}
      className="bg-muted border-border text-foreground h-9 text-sm placeholder:text-muted-foreground"
    />
  );
}
