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
  const [results, setResults] = useState<{
    success: number;
    failed: number;
    duplicates: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const downloadTemplate = () => {
    const template = "Name,Contact Person,Phone,Email,Source,Industry,Status,Address,Area,City,State,Country,Pincode,Latitude,Longitude\nShivalli Seeds Pvt Ltd,Ramesh Patil,919876543210,sales@example.in,Website,Seeds,New,Plot 14 Industrial Estate,Ranebennur,Haveri,Karnataka,India,581115,14.6167,75.6300";
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

      // Expected headers: name, contactperson, phone/whatsapp, email, source, industry,
      // status, address, area, city, state, country, pincode, latitude, longitude

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
      const areaIdx = getIdx(['area', 'locality']);
      const pincodeIdx = getIdx(['pincode', 'pin', 'postal', 'zip']);
      const latIdx = getIdx(['latitude']);
      const lngIdx = getIdx(['longitude']);

      const supabase = createClient();
      let successCount = 0;
      let failCount = 0;
      let duplicateCount = 0;

      const cell = (row: string[], idx: number) => {
        if (idx < 0) return null;
        const value = (row[idx] ?? '').trim();
        return value === '' ? null : value;
      };

      const num = (row: string[], idx: number) => {
        const value = cell(row, idx);
        if (value === null) return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      };

      // Build every payload up front so duplicates inside the file can be removed
      // before any insert. `leads` has a unique index on (account_id, phone) since
      // migration 20261005150000, and one duplicate in a batch of 50 rejects all
      // 50 — so a file carrying the same number twice used to lose 49 good rows
      // with it.
      const seenPhones = new Set<string>();
      const payloads: Record<string, unknown>[] = [];

      for (const row of dataRows) {
        const name = cell(row, nameIdx);
        if (!name) {
          failCount++; // Name is required
          continue;
        }

        const phone = cell(row, phoneIdx);
        const normalized = phone ? phone.replace(/\D/g, '') : '';
        if (normalized) {
          if (seenPhones.has(normalized)) {
            duplicateCount++;
            continue;
          }
          seenPhones.add(normalized);
        }

        payloads.push({
          account_id: accountId,
          user_id: user.id,
          name: name.substring(0, 255),
          contact_person: cell(row, personIdx),
          // Both columns: `phone` is what the duplicate index is built on, and
          // `whatsapp` is what the messaging features read. Writing only one of
          // them either skips the duplicate check or breaks WhatsApp.
          phone,
          whatsapp: phone,
          email: cell(row, emailIdx),
          source: cell(row, sourceIdx),
          industry: cell(row, industryIdx),
          status: cell(row, statusIdx),
          address: cell(row, addressIdx),
          area: cell(row, areaIdx),
          city: cell(row, cityIdx),
          state: cell(row, stateIdx),
          country: cell(row, countryIdx),
          pincode: cell(row, pincodeIdx),
          latitude: num(row, latIdx),
          longitude: num(row, lngIdx),
        });
      }

      // Process in batches of 50 to avoid hammering DB
      const batchSize = 50;
      for (let i = 0; i < payloads.length; i += batchSize) {
        const batch = payloads.slice(i, i + batchSize);

        const bulk = await supabase.from('leads').insert(batch).select('id');
        let inserted: { id: string }[] = bulk.data ?? [];

        if (bulk.error) {
          // Almost always one row colliding with a lead that already exists. Retry
          // the batch row by row so the other 49 still land, and so the failure
          // count is the true number of bad rows rather than the batch size.
          inserted = [];
          for (const payload of batch) {
            const single = await supabase.from('leads').insert(payload).select('id');
            if (single.error) {
              if (single.error.code === '23505') duplicateCount++;
              else failCount++;
            } else if (single.data) {
              inserted.push(...single.data);
            }
          }
        }

        if (inserted.length > 0) {
          successCount += inserted.length;

          // Log activities for all successful inserts
          const logPromises = inserted.map(record => logModuleActivity(supabase, {
            moduleName: "lead",
            recordId: record.id,
            action: "created",
            message: "Lead imported via CSV"
          }));
          await Promise.all(logPromises);
        }
      }

      setResults({ success: successCount, failed: failCount, duplicates: duplicateCount });
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
                {results.duplicates > 0 && (
                  <div className="text-center">
                    <p className="text-2xl font-bold text-muted-foreground">{results.duplicates}</p>
                    <p className="text-muted-foreground">Already had</p>
                  </div>
                )}
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
