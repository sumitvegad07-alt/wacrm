"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { TaskAttachment } from "@/types";
import { Button } from "@/components/ui/button";
import { Loader2, Paperclip, Trash2, Download, FileText, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

interface TaskAttachmentsProps {
  taskId: string;
}

export function TaskAttachmentsSection({ taskId }: TaskAttachmentsProps) {
  const supabase = createClient();
  const { user } = useAuth();
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchAttachments();
  }, [taskId]);

  async function fetchAttachments() {
    setLoading(true);
    const { data, error } = await supabase
      .from("task_attachments")
      .select("*")
      .eq("task_id", taskId)
      .order("created_at", { ascending: false });

    if (!error && data) {
      setAttachments(data as TaskAttachment[]);
    }
    setLoading(false);
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0 || !user) return;

    setUploading(true);
    let successCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileExt = file.name.split('.').pop();
      const fileName = `${taskId}/${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("task-attachments")
        .upload(fileName, file);

      if (uploadError) {
        toast.error(`Failed to upload ${file.name}`);
        continue;
      }

      const { data: publicUrlData } = supabase.storage
        .from("task-attachments")
        .getPublicUrl(fileName);

      const { error: dbError } = await supabase.from("task_attachments").insert({
        task_id: taskId,
        user_id: user.id,
        file_name: file.name,
        file_url: publicUrlData.publicUrl,
        file_size: file.size,
        content_type: file.type,
      });

      if (!dbError) {
        successCount++;
      }
    }

    if (successCount > 0) {
      toast.success(`Uploaded ${successCount} file(s)`);
      fetchAttachments();
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setUploading(false);
  }

  async function deleteAttachment(attachment: TaskAttachment) {
    // Optimistic
    setAttachments((prev) => prev.filter((a) => a.id !== attachment.id));

    // Extract path from public URL
    const urlParts = attachment.file_url.split('/task-attachments/');
    if (urlParts.length > 1) {
      const filePath = urlParts[1];
      await supabase.storage.from("task-attachments").remove([filePath]);
    }

    const { error } = await supabase
      .from("task_attachments")
      .delete()
      .eq("id", attachment.id);

    if (error) {
      toast.error("Failed to delete attachment");
      fetchAttachments();
    }
  }

  function formatBytes(bytes?: number | null) {
    if (!bytes) return "Unknown size";
    if (bytes < 1024) return bytes + " B";
    else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    else return (bytes / 1048576).toFixed(1) + " MB";
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Paperclip className="size-5 text-muted-foreground" />
          Attachments
        </h3>
        <div>
          <input
            type="file"
            multiple
            className="hidden"
            ref={fileInputRef}
            onChange={handleFileUpload}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? <Loader2 className="size-4 animate-spin mr-2" /> : <Paperclip className="size-4 mr-2" />}
            Attach Files
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading attachments...
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {attachments.map((file) => (
            <div
              key={file.id}
              className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card group hover:border-primary/50 transition-colors"
            >
              <div className="shrink-0 size-10 rounded bg-muted flex items-center justify-center text-muted-foreground">
                {file.content_type?.startsWith("image/") ? (
                  <ImageIcon className="size-5" />
                ) : (
                  <FileText className="size-5" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate" title={file.file_name}>
                  {file.file_name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(file.file_size)} • {formatDistanceToNow(new Date(file.created_at), { addSuffix: true })}
                </p>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <a
                  href={file.file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded"
                >
                  <Download className="size-4" />
                </a>
                <button
                  onClick={() => deleteAttachment(file)}
                  className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          ))}

          {attachments.length === 0 && !uploading && (
            <div className="col-span-full p-6 text-center border border-dashed rounded-lg border-border">
              <Paperclip className="size-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">No attachments yet</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
