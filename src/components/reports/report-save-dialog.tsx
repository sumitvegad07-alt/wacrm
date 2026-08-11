"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { saveReportConfig } from "@/app/actions/reports";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { type ReportConfig, type ReportSharingMode } from "@/lib/reports/types";

interface ReportSaveDialogProps {
  moduleName: string;
  reportState: ReportConfig;
}

export function ReportSaveDialog({ moduleName, reportState }: ReportSaveDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [sharingMode, setSharingMode] = useState<ReportSharingMode>("private");
  const [isDefault, setIsDefault] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    try {
      setLoading(true);
      await saveReportConfig(moduleName, name, { ...reportState, is_default: isDefault }, sharingMode);
      setSaved(true);
      setTimeout(() => {
        setOpen(false);
        setSaved(false);
        setName("");
      }, 1000);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Save className="mr-2 h-4 w-4" />
        Save
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Save Report</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="name">Report Name</Label>
            <Input
              id="name"
              placeholder="e.g. Monthly Region Sales"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="sharing">Sharing Scope</Label>
            <Select value={sharingMode} onValueChange={(val) => setSharingMode(val as ReportSharingMode)}>
              <SelectTrigger id="sharing">
                <SelectValue placeholder="Select scope" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private">Private (Only me)</SelectItem>
                <SelectItem value="team">Team</SelectItem>
                <SelectItem value="organization">Organization</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center space-x-2 mt-2">
            <Checkbox 
              id="isDefault" 
              checked={isDefault}
              onCheckedChange={(checked) => setIsDefault(checked as boolean)}
            />
            <Label htmlFor="isDefault" className="font-normal cursor-pointer">
              Set as my default view for this module
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={loading || !name.trim()}>
            {loading ? "Saving..." : saved ? "Saved ✓" : "Save Report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
