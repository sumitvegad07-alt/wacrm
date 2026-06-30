'use client';

import { useRef, useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Upload, FileText, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ImportProductsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

export function ImportProductsModal({ open, onOpenChange, onImported }: ImportProductsModalProps) {
  const supabase = createClient();
  const { accountId, user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<{ base: any, custom: any[] }[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; failed: number } | null>(null);
  const [customFields, setCustomFields] = useState<any[]>([]);

  useEffect(() => {
    if (open && accountId) {
      supabase
        .from('custom_fields')
        .select('*')
        .eq('module_name', 'product')
        .order('field_name')
        .then(({ data }) => {
          if (data) setCustomFields(data);
        });
    }
  }, [open, accountId]);

  function reset() {
    setFile(null);
    setParsedRows([]);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function handleDownloadDemo() {
    const headers = ['name', 'sku', 'price', 'description', 'category', 'unit', ...customFields.map((f) => f.field_name.toLowerCase())];
    const row = ['Premium Widget', 'WIDG-01', '29.99', 'A high quality widget', 'Electronics', 'pcs', ...customFields.map(() => '')];
    const csvContent = [headers.join(','), row.join(',')].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'products_demo.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;

    setFile(selected);
    setResult(null);

    const text = await selected.text();
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) {
      toast.error('No valid rows found.');
      return;
    }

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/["']/g, ''));
    const nameIdx = headers.indexOf('name');
    
    if (nameIdx === -1) {
      toast.error('CSV must have a "name" column.');
      return;
    }

    const skuIdx = headers.indexOf('sku');
    const priceIdx = headers.indexOf('price');
    const descIdx = headers.indexOf('description');

    const categoryIdx = headers.indexOf('category');
    const unitIdx = headers.indexOf('unit');

    const cfMapping: { [key: string]: string } = {};
    customFields.forEach(cf => {
      cfMapping[cf.field_name.toLowerCase()] = cf.id;
    });

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const values = line.split(',').map(v => v.trim().replace(/["']/g, ''));
      const name = values[nameIdx];
      if (!name) continue;

      const custom: { custom_field_id: string, value: string }[] = [];
      headers.forEach((h, idx) => {
        if (cfMapping[h] && values[idx]) {
          custom.push({ custom_field_id: cfMapping[h], value: values[idx] });
        }
      });

      rows.push({
        base: {
          name,
          sku: skuIdx >= 0 ? values[skuIdx] : null,
          price: priceIdx >= 0 && values[priceIdx] ? parseFloat(values[priceIdx]) : null,
          description: descIdx >= 0 ? values[descIdx] : null,
          category: categoryIdx >= 0 ? values[categoryIdx] : null,
          unit: unitIdx >= 0 ? values[unitIdx] : null,
        },
        custom
      });
    }

    setParsedRows(rows);
  }

  async function handleImport() {
    if (parsedRows.length === 0 || !accountId || !user) return;
    setImporting(true);

    let imported = 0;
    let failed = 0;

    for (const row of parsedRows) {
      const { data, error } = await supabase.from('products').insert({
        ...row.base,
        account_id: accountId,
        user_id: user.id,
      }).select('id').single();

      if (error) {
        failed++;
      } else {
        imported++;
        if (row.custom.length > 0) {
          const cfInserts = row.custom.map((c: any) => ({
            product_id: data.id,
            custom_field_id: c.custom_field_id,
            value: c.value
          }));
          await supabase.from('product_custom_values').insert(cfInserts);
        }
      }
    }

    setResult({ imported, failed });
    if (imported > 0) {
      toast.success(`${imported} product(s) imported successfully`);
      onImported();
    }
    if (failed > 0) toast.error(`${failed} product(s) failed to import`);
    
    setImporting(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex flex-col gap-0 overflow-hidden border-border/80 bg-popover p-0 text-popover-foreground sm:max-w-xl">
        <div className="shrink-0 space-y-4 border-b border-border/80 px-6 pt-6 pb-5">
          <DialogHeader className="gap-1.5">
            <DialogTitle className="text-lg">Import Products</DialogTitle>
            <DialogDescription>
              Upload a CSV with a required <code className="rounded bg-muted px-1 text-[11px]">name</code> column. 
              Optional: <code className="rounded bg-muted px-1 text-[11px]">sku</code>, <code className="rounded bg-muted px-1 text-[11px]">price</code>, <code className="rounded bg-muted px-1 text-[11px]">category</code>, <code className="rounded bg-muted px-1 text-[11px]">unit</code>, and any custom fields you have created.
            </DialogDescription>
            <div className="pt-2">
              <Button variant="outline" size="sm" onClick={handleDownloadDemo} className="gap-2 text-xs h-8">
                <FileText className="size-3.5" /> Download Demo CSV
              </Button>
            </div>
          </DialogHeader>

          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              'group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-5 transition-all',
              file ? 'border-primary/35 bg-primary/[0.04]' : 'hover:border-primary/40 border-border/80 bg-background/40 hover:bg-background/70'
            )}
          >
            {file ? (
              <>
                <FileText className="text-primary size-5" />
                <p className="max-w-full truncate text-sm">{file.name}</p>
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] text-muted-foreground">{parsedRows.length} rows ready</span>
              </>
            ) : (
              <>
                <Upload className="size-5 text-muted-foreground group-hover:text-foreground" />
                <p className="text-sm text-muted-foreground">Click to choose a CSV file</p>
              </>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={handleFileChange} className="hidden" />
        </div>

        {result && (
          <div className="p-6 pb-2">
            <div className="rounded-xl border border-border bg-background/50 p-4">
              <p className="text-sm font-medium">Import complete</p>
              <div className="mt-3 flex gap-3">
                {result.imported > 0 && <div className="flex items-center gap-1.5 text-sm text-primary"><CheckCircle className="size-4" />{result.imported} imported</div>}
                {result.failed > 0 && <div className="flex items-center gap-1.5 text-sm text-red-400"><XCircle className="size-4" />{result.failed} failed</div>}
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="border-t border-border/80 bg-background/50 px-6 py-4">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {result ? 'Close' : 'Cancel'}
          </Button>
          {!result && (
            <Button disabled={parsedRows.length === 0 || importing} onClick={handleImport}>
              {importing && <Loader2 className="size-4 animate-spin mr-2" />}
              Import {parsedRows.length} products
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
