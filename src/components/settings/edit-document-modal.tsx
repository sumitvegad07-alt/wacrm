'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Pencil } from 'lucide-react';
import { updateKnowledgeDocument } from '@/app/(dashboard)/settings/ai/actions';
import { toast } from 'sonner';

interface EditDocumentModalProps {
  document: any;
  onSuccess?: () => void;
}

export function EditDocumentModal({ document, onSuccess }: EditDocumentModalProps) {
  const [open, setOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const handleUpdate = async (formData: FormData) => {
    setIsPending(true);
    try {
      await updateKnowledgeDocument(document.id, formData);
      toast.success('Document updated successfully');
      setOpen(false);
      if (onSuccess) onSuccess();
    } catch (error: any) {
      toast.error(error.message || 'Failed to update document');
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" />}>
        <Pencil className="size-4" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px]">
        <form action={handleUpdate}>
          <DialogHeader>
            <DialogTitle>Edit Knowledge Document</DialogTitle>
            <DialogDescription>
              Update the source text for this document. It will be re-processed into the Knowledge Base.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                name="title"
                defaultValue={document.title}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="content">Raw Text Content</Label>
              <Textarea
                id="content"
                name="content"
                defaultValue={document.content_text}
                required
                rows={12}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Updating...' : 'Update & Re-ingest'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
