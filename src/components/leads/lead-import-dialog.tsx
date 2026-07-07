"use client";

import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, UploadCloud, CheckCircle, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { logModuleActivity } from "@/lib/activities";

interface LeadImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function LeadImportDialog({ open, onOpenChange, onSuccess }: LeadImportDialogProps) {
  const { accountId, user } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState<{ success: number; failed: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const downloadTemplate = () => {
    const template = "Name,Contact Person,WhatsApp,Email,Source,Industry,Status,Address,City,State,Country,Latitude,Longitude\nExample Lead,John Doe,+1234567890,john@example.com,Website,Technology,New,123 Main St,New York,NY,USA,40.7128,-74.0060";
    const blob = new Blob([template], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', 'leads_import_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
      setResults(null);
    }
  };

  // Basic CSV parser that handles quotes
  const parseCSV = (text: string) => {
    const lines = [];
    let currentLine = [];
    let currentVal = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          currentVal += '"';
          i++; // skip next quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        currentLine.push(currentVal.trim());
        currentVal = '';
      } else if (char === '\n' && !inQuotes) {
        currentLine.push(currentVal.trim());
        lines.push(currentLine);
        currentLine = [];
        currentVal = '';
      } else if (char !== '\r') {
        currentVal += char;
      }
    }
    
    if (currentVal || text.endsWith(',')) {
        currentLine.push(currentVal.trim());
    }
    if (currentLine.length > 0) {
        lines.push(currentLine);
    }

    return lines;
  };

  const processImport = async () => {
    if (!file || !accountId || !user) return;
    setIsProcessing(true);
    setResults(null);

    try {
      const text = await file.text();
      const rows = parseCSV(text);
      
      if (rows.length < 2) {
        toast.error("File is empty or missing headers");
        setIsProcessing(false);
        return;
      }

      const headers = rows[0].map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
      const dataRows = rows.slice(1).filter(r => r.some(cell => cell.trim() !== ''));

      // Expected headers: name, contactperson, whatsapp, email, source, industry, status, address, city, state, country, latitude, longitude
      
      const nameIdx = headers.findIndex(h => h.includes('name') || h.includes('business'));
      if (nameIdx === -1) {
        toast.error("CSV must contain a 'Name' or 'Business Name' column");
        setIsProcessing(false);
        return;
      }

      const getIdx = (keywords: string[]) => headers.findIndex(h => keywords.some(k => h.includes(k)));
      
      const personIdx = getIdx(['person', 'contact']);
      const phoneIdx = getIdx(['phone', 'whatsapp', 'mobile', 'number']);
      const emailIdx = getIdx(['email']);
      const sourceIdx = getIdx(['source']);
      const industryIdx = getIdx(['industry']);
      const statusIdx = getIdx(['status']);
      const addressIdx = getIdx(['address', 'street']);
      const cityIdx = getIdx(['city']);
      const stateIdx = getIdx(['state', 'region', 'province']);
      const countryIdx = getIdx(['country']);

      const supabase = createClient();
      let successCount = 0;
      let failCount = 0;

      // Process in batches of 50 to avoid hammering DB
      const batchSize = 50;
      for (let i = 0; i < dataRows.length; i += batchSize) {
        const batch = dataRows.slice(i, i + batchSize);
        
        const payloads = batch.map(row => {
          const name = row[nameIdx];
          if (!name) return null; // Name is required
          
          return {
            account_id: accountId,
            user_id: user.id,
            name: name.substring(0, 255),
            contact_person: personIdx >= 0 ? row[personIdx] : null,
            whatsapp: phoneIdx >= 0 ? row[phoneIdx] : null,
            email: emailIdx >= 0 ? row[emailIdx] : null,
            source: sourceIdx >= 0 ? row[sourceIdx] : null,
            industry: industryIdx >= 0 ? row[industryIdx] : null,
            status: statusIdx >= 0 ? row[statusIdx] : null,
            address: addressIdx >= 0 ? row[addressIdx] : null,
            city: cityIdx >= 0 ? row[cityIdx] : null,
            state: stateIdx >= 0 ? row[stateIdx] : null,
            country: countryIdx >= 0 ? row[countryIdx] : null,
          };
        }).filter(Boolean) as any[];

        if (payloads.length === 0) {
            failCount += batch.length;
            continue;
        }

        const { data, error } = await supabase.from('leads').insert(payloads).select('id');
        
        if (error) {
          console.error("Batch insert error:", error);
          failCount += batch.length;
        } else if (data) {
          successCount += data.length;
          failCount += (batch.length - data.length);
          
          // Log activities for all successful inserts
          const logPromises = data.map(record => logModuleActivity(supabase, {
            moduleName: "lead",
            recordId: record.id,
            action: "created",
            message: "Lead imported via CSV"
          }));
          await Promise.all(logPromises);
        }
      }

      setResults({ success: successCount, failed: failCount });
      if (successCount > 0) {
        onSuccess();
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to parse or process CSV file");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setResults(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import Leads</DialogTitle>
          <DialogDescription>
            Upload a CSV file containing your leads. The first row must be headers (e.g. Name, Email, WhatsApp, City).
          </DialogDescription>
        </DialogHeader>
        
        <div className="py-6">
          {!results ? (
            <div className="space-y-4">
              <div 
                className="border-2 border-dashed border-border rounded-lg p-8 flex flex-col items-center justify-center bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <input 
                  type="file" 
                  ref={fileInputRef}
                  className="hidden" 
                  accept=".csv"
                  onChange={handleFileChange}
                />
                <UploadCloud className="size-10 text-muted-foreground mb-4" />
                <p className="text-sm font-medium text-foreground text-center">
                  {file ? file.name : "Click to select a CSV file"}
                </p>
                {!file && <p className="text-xs text-muted-foreground mt-1">Maximum 1000 rows recommended</p>}
              </div>
              <div className="flex justify-between items-center text-sm mt-4 text-muted-foreground px-1">
                <Button variant="link" onClick={downloadTemplate} className="px-0 h-auto text-primary">
                  Download Demo File
                </Button>
                <span>Maximum 1000 rows recommended</span>
              </div>

              {file && (
                <div className="flex justify-between items-center text-sm px-1">
                  <span className="text-muted-foreground">Ready to process {file.name}</span>
                  <Button variant="ghost" size="sm" onClick={handleReset} className="h-auto py-1">Remove</Button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4 text-center">
              <div className="flex justify-center mb-2">
                {results.failed === 0 ? (
                  <div className="size-12 rounded-full bg-green-500/10 flex items-center justify-center">
                    <CheckCircle className="size-6 text-green-600" />
                  </div>
                ) : (
                  <div className="size-12 rounded-full bg-amber-500/10 flex items-center justify-center">
                    <AlertTriangle className="size-6 text-amber-600" />
                  </div>
                )}
              </div>
              <h3 className="text-lg font-medium text-foreground">Import Complete</h3>
              <div className="flex justify-center gap-8 text-sm">
                <div className="text-center">
                  <p className="text-2xl font-bold text-green-600">{results.success}</p>
                  <p className="text-muted-foreground">Imported</p>
                </div>
                {results.failed > 0 && (
                  <div className="text-center">
                    <p className="text-2xl font-bold text-amber-600">{results.failed}</p>
                    <p className="text-muted-foreground">Failed/Skipped</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="sm:justify-end gap-2">
          {!results ? (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isProcessing}>
                Cancel
              </Button>
              <Button type="button" onClick={processImport} disabled={!file || isProcessing}>
                {isProcessing && <Loader2 className="mr-2 size-4 animate-spin" />}
                {isProcessing ? "Processing..." : "Import Leads"}
              </Button>
            </>
          ) : (
            <Button type="button" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
