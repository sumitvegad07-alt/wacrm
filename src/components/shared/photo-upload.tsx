"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { MediaUpload } from "./media-upload";

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
  hint?: string;
  disabled?: boolean;
}

/**
 * Single-image upload with immediate storage upload — thin wrapper over the
 * shared MediaUpload so a profile photo looks identical to a product image or a
 * payment proof (same square tile, same add affordance). `label` renders the
 * shared section header.
 */
export function PhotoUpload({
  value,
  onChange,
  bucket,
  label = "Photo",
  hint = "PNG, JPG, WebP or GIF. Recommended 256×256px. Max 10 MB.",
  disabled,
}: PhotoUploadProps) {
  const supabase = createClient();
  const [uploading, setUploading] = useState(false);

  async function handlePick(files: File[]) {
    const file = files[0];
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
    }
  }

  return (
    <div className="space-y-3">
      {label && (
        <h4 className="text-sm font-semibold text-foreground border-b border-border pb-1.5">
          {label}
        </h4>
      )}
      <MediaUpload
        items={value ? [{ key: "photo", url: value }] : []}
        onPick={handlePick}
        onRemove={() => onChange("")}
        accept={ACCEPTED.join(",")}
        multiple={false}
        busy={uploading}
        hint={hint}
        addLabel="Upload"
        disabled={disabled}
      />
    </div>
  );
}
