"use client";

import { useRef, useState } from "react";
import { Upload, FileText, Loader2, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { bulkImportTerritories, type ImportResult } from "@/lib/territories/api";

interface Props {
  accountId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

export function TerritoryImportDialog({ accountId, open, onOpenChange, onImported }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [csv, setCsv] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  function reset() {
    setFileName(null);
    setCsv("");
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    setResult(null);
    setCsv(await f.text());
  }

  async function runImport() {
    if (!csv.trim()) return;
    setBusy(true);
    try {
      const res = await bulkImportTerritories(accountId, csv);
      setResult(res);
      if (res.success > 0) onImported();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import territories</DialogTitle>
          <DialogDescription>
            CSV columns: <code>parent_path,name,code,notes</code>. <code>parent_path</code> is the
            slash-joined ancestor names (empty for a top-level row), e.g. <code>India/Gujarat</code>.
            Rows are validated individually — good rows import even if others fail.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 py-8 hover:bg-muted/50"
          >
            <Upload className="size-6 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              {fileName ? "Choose a different file" : "Click to choose a CSV file"}
            </span>
          </button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />

          {fileName && (
            <div className="flex items-center gap-2 text-sm text-foreground">
              <FileText className="size-4 text-muted-foreground" /> {fileName}
            </div>
          )}

          {result && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle className="size-4 text-green-500" />
                <span className="font-medium">{result.success}</span> imported
                {result.errors.length > 0 && (
                  <>
                    <XCircle className="size-4 text-red-500 ml-3" />
                    <span className="font-medium">{result.errors.length}</span> failed
                  </>
                )}
              </div>
              {result.errors.length > 0 && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 max-h-48 overflow-y-auto">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-500 mb-1">
                    <AlertTriangle className="size-3.5" /> Row errors
                  </div>
                  <ul className="space-y-0.5 text-xs text-muted-foreground">
                    {result.errors.map((e) => (
                      <li key={e.row}>
                        Row {e.row}: {e.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {result ? "Close" : "Cancel"}
          </Button>
          <Button onClick={runImport} disabled={!csv.trim() || busy}>
            {busy && <Loader2 className="size-4 mr-1 animate-spin" />}
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
