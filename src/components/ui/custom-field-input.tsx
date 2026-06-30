'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { CustomField } from '@/types';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, X } from 'lucide-react';

interface CustomFieldInputProps {
  field: CustomField;
  value: string;
  onChange: (val: string) => void;
}

export function CustomFieldInput({ field, value, onChange }: CustomFieldInputProps) {
  const [uploading, setUploading] = useState(false);
  const supabase = createClient();

  const options = field.field_options as { choices?: string[] } | undefined;
  const choices = options?.choices || [];

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
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-9 rounded-md border border-border bg-muted px-2.5 text-sm outline-none text-foreground"
      >
        <option value="">Select option...</option>
        {choices.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
    );
  }

  if (field.field_type === 'radio') {
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
    const selectedVals = value ? value.split(',').map(s => s.trim()) : [];
    return (
      <div className="space-y-2 mt-1 p-2 border border-border rounded-md bg-muted/30">
        {choices.map(c => (
          <label key={c} className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
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
