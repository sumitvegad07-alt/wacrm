"use client";

import { useRef, useState } from "react";
import { Loader2, Upload, Trash2, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_BYTES = 10 * 1024 * 1024;

interface PhotoUploadProps {
  /** Current image URL (empty string when none). */
  value: string;
  onChange: (url: string) => void;
  /** Storage bucket to upload into (public bucket). */
  bucket: string;
  /** Section heading, e.g. "Profile Picture" / "Product Image". */
  label?: string;
  /** Single fallback letter/emoji shown before an image is chosen. */
  fallback?: string;
  /** Preview shape — avatars are square-rounded, logos can be circular. */
  shape?: "square" | "circle";
  hint?: string;
  disabled?: boolean;
}

/**
 * The one image-upload control for create/edit forms. Same preview, same
 * "Upload / Remove" buttons, same helper text everywhere — and always the FIRST
 * field of a form. Replaces every module's bespoke avatar/image block.
 */
export function PhotoUpload({
  value,
  onChange,
  bucket,
  label = "Photo",
  fallback = "?",
  shape = "square",
  hint = "PNG, JPG, WebP or GIF. Recommended 256×256px. Max 10 MB.",
  disabled,
}: PhotoUploadProps) {
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) {
      toast.error("Unsupported image type. Use PNG, JPG, WebP or GIF.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Image is too large. Maximum 10 MB.");
      return;
    }
    try {
      setUploading(true);
      const ext = file.name.split(".").pop();
      const filePath = `${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from(bucket).upload(filePath, file);
      if (error) throw error;
      const { data } = supabase.storage.from(bucket).getPublicUrl(filePath);
      onChange(data.publicUrl);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error uploading image");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-3">
      {label && (
        <h4 className="text-sm font-medium text-foreground border-b border-border pb-1.5">
          {label}
        </h4>
      )}
      <div className="flex items-center gap-5">
        <Avatar
          className={cn(
            "h-24 w-24 border border-border shadow-sm shrink-0",
            shape === "circle" ? "rounded-full" : "rounded-xl",
          )}
        >
          {value ? (
            <AvatarImage src={value} className="object-cover" />
          ) : (
            <AvatarFallback
              className={cn(
                "text-2xl font-medium bg-muted text-muted-foreground",
                shape === "circle" ? "rounded-full" : "rounded-xl",
              )}
            >
              {fallback ? fallback.charAt(0).toUpperCase() : <ImageIcon className="h-7 w-7" />}
            </AvatarFallback>
          )}
        </Avatar>
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || disabled}
            >
              {uploading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Upload className="w-4 h-4 mr-2" />
              )}
              {value ? "Change Photo" : "Upload Photo"}
            </Button>
            {value && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange("")}
                disabled={uploading || disabled}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Remove
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
      </div>
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept={ACCEPTED.join(",")}
        onChange={handleFile}
        disabled={uploading || disabled}
      />
    </div>
  );
}
