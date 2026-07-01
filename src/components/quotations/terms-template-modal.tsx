'use client';

import { useState, useRef, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight, List, Code, Loader2 } from 'lucide-react';
import type { QuotationTermsTemplate } from '@/types';

interface TermsTemplateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (template: QuotationTermsTemplate) => void;
  initialData?: QuotationTermsTemplate | null;
}

export function TermsTemplateModal({ open, onOpenChange, onSave, initialData }: TermsTemplateModalProps) {
  const supabase = createClient();
  const editorRef = useRef<HTMLDivElement>(null);
  
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [status, setStatus] = useState('Active');
  const [isDefault, setIsDefault] = useState(false);

  useEffect(() => {
    if (open) {
      if (initialData) {
        setTitle(initialData.title || '');
        setContent(initialData.content || '');
        setStatus(initialData.status || 'Active');
        setIsDefault(initialData.is_default || false);
        if (editorRef.current) {
          editorRef.current.innerHTML = initialData.content || '';
        }
      } else {
        setTitle('');
        setContent('');
        setStatus('Active');
        setIsDefault(false);
        if (editorRef.current) {
          editorRef.current.innerHTML = '';
        }
      }
    }
  }, [open, initialData]);

  const execCommand = (command: string, arg?: string) => {
    document.execCommand(command, false, arg);
    editorRef.current?.focus();
    handleInput();
  };

  const handleInput = () => {
    if (editorRef.current) {
      setContent(editorRef.current.innerHTML);
    }
  };

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error('Name is required');
      return;
    }
    
    setLoading(true);
    
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setLoading(false);
      return;
    }
    
    const { data: accountData } = await supabase.from('profiles').select('account_id').eq('user_id', userData.user.id).single();
    if (!accountData) {
      setLoading(false);
      return;
    }

    // If making default, unset other defaults
    if (isDefault) {
      await supabase
        .from('quotation_terms_templates')
        .update({ is_default: false })
        .eq('account_id', accountData.account_id);
    }

    const payload = {
      account_id: accountData.account_id,
      title: title.trim(),
      content,
      status,
      is_default: isDefault,
    };

    let result;
    if (initialData?.id) {
      result = await supabase
        .from('quotation_terms_templates')
        .update(payload)
        .eq('id', initialData.id)
        .select('*')
        .single();
    } else {
      result = await supabase
        .from('quotation_terms_templates')
        .insert([payload])
        .select('*')
        .single();
    }

    if (result.error) {
      toast.error('Failed to save template');
    } else if (result.data) {
      toast.success('Template saved successfully');
      onSave(result.data);
      onOpenChange(false);
    }
    
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden bg-background border-border">
        <DialogHeader className="px-6 py-4 border-b border-border bg-muted/30">
          <DialogTitle className="text-xl">{initialData ? 'Edit Terms & Conditions' : 'Add Terms & Conditions'}</DialogTitle>
        </DialogHeader>
        
        <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
          <div className="space-y-2">
            <Label htmlFor="title">Name <span className="text-destructive">*</span></Label>
            <Input 
              id="title" 
              value={title} 
              onChange={e => setTitle(e.target.value)} 
              placeholder="e.g., Standard Terms" 
              className="bg-background"
            />
          </div>

          <div className="space-y-2">
            <Label>Terms & Conditions</Label>
            <div className="border border-border rounded-md overflow-hidden bg-background focus-within:ring-1 focus-within:ring-ring">
              <div className="flex flex-wrap items-center gap-1 border-b border-border bg-muted/30 p-1">
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => execCommand('bold')} className="h-8 w-8 text-muted-foreground hover:text-foreground">
                  <Bold className="h-4 w-4" />
                </Button>
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => execCommand('italic')} className="h-8 w-8 text-muted-foreground hover:text-foreground">
                  <Italic className="h-4 w-4" />
                </Button>
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => execCommand('underline')} className="h-8 w-8 text-muted-foreground hover:text-foreground">
                  <Underline className="h-4 w-4" />
                </Button>
                <div className="h-4 w-px bg-border mx-1" />
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => execCommand('justifyLeft')} className="h-8 w-8 text-muted-foreground hover:text-foreground">
                  <AlignLeft className="h-4 w-4" />
                </Button>
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => execCommand('justifyCenter')} className="h-8 w-8 text-muted-foreground hover:text-foreground">
                  <AlignCenter className="h-4 w-4" />
                </Button>
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => execCommand('justifyRight')} className="h-8 w-8 text-muted-foreground hover:text-foreground">
                  <AlignRight className="h-4 w-4" />
                </Button>
                <div className="h-4 w-px bg-border mx-1" />
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => execCommand('insertUnorderedList')} className="h-8 w-8 text-muted-foreground hover:text-foreground">
                  <List className="h-4 w-4" />
                </Button>
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => execCommand('formatBlock', 'PRE')} className="h-8 w-8 text-muted-foreground hover:text-foreground">
                  <Code className="h-4 w-4" />
                </Button>
              </div>
              
              <div 
                ref={editorRef}
                contentEditable 
                onInput={handleInput}
                onBlur={handleInput}
                className="min-h-[250px] p-4 text-sm focus:outline-none max-h-[400px] overflow-y-auto"
                style={{ whiteSpace: 'pre-wrap' }}
              />
            </div>
          </div>
          
          <div className="flex items-center space-x-2">
            <Checkbox 
              id="default" 
              checked={isDefault}
              onCheckedChange={(checked) => setIsDefault(checked === true)}
            />
            <Label htmlFor="default" className="cursor-pointer">Set as default template</Label>
          </div>

          <div className="space-y-2">
            <Label>Status</Label>
            <RadioGroup value={status} onValueChange={setStatus} className="flex gap-4">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="Active" id="status-active" />
                <Label htmlFor="status-active" className="font-normal cursor-pointer">Active</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="Inactive" id="status-inactive" />
                <Label htmlFor="status-inactive" className="font-normal cursor-pointer">Inactive</Label>
              </div>
            </RadioGroup>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-border bg-muted/20 flex justify-end">
          <Button onClick={handleSave} disabled={loading} className="px-8 bg-blue-600 hover:bg-blue-700 text-white">
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            UPDATE
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
