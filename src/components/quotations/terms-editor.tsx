'use client';

import { useState, useRef, useEffect } from 'react';
import { Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight, List, Code } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { TermsTemplateModal } from './terms-template-modal';
import type { QuotationTermsTemplate } from '@/types';

interface TermsEditorProps {
  value: string;
  onChange: (value: string) => void;
  templates: QuotationTermsTemplate[];
  onTemplateAdded?: (template: QuotationTermsTemplate) => void;
}

export function TermsEditor({ value, onChange, templates, onTemplateAdded }: TermsEditorProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  
  // Initialize content once
  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value || '';
    }
  }, [value]);

  const execCommand = (command: string, arg?: string) => {
    document.execCommand(command, false, arg);
    editorRef.current?.focus();
    handleInput();
  };

  const handleInput = () => {
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  };

  const insertTemplate = (content: string) => {
    onChange(content);
    if (editorRef.current) {
      editorRef.current.innerHTML = content;
    }
    setOpen(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="w-full max-w-sm flex gap-2">
          <SearchableSelect
            options={templates.map(t => ({ label: t.title, value: t.id }))}
            value=""
            onChange={(val) => {
              const template = templates.find(t => t.id === val);
              if (template) insertTemplate(template.content);
            }}
            placeholder="Select Template..."
          />
          {onTemplateAdded && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setModalOpen(true)}
            >
              Add Template
            </Button>
          )}
        </div>
      </div>

      <TermsTemplateModal 
        open={modalOpen} 
        onOpenChange={setModalOpen} 
        onSave={(newTemplate) => {
          if (onTemplateAdded) onTemplateAdded(newTemplate);
        }} 
      />

      <div className="border border-border rounded-md overflow-hidden bg-background">
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
          className="min-h-[200px] p-4 text-sm focus:outline-none max-h-[500px] overflow-y-auto"
          style={{ whiteSpace: 'pre-wrap' }}
        />
      </div>
    </div>
  );
}
