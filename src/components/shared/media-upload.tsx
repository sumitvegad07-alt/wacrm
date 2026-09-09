"use client";

import { useRef, useState } from "react";
import { UploadCloud, X, FileText, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MediaUploadItem {
  /** Stable key used for removal. */
  key: string;
  /** Image/blob URL to preview. Ignored when `label` is set (file chip). */
  url?: string;
  /** When set, render a file chip (icon + name) instead of an image preview. */
  label?: string;
  /** Small corner badge, e.g. "Primary". */
  badge?: string;
}

interface MediaUploadProps {
  items: MediaUploadItem[];
  onPick: (files: File[]) => void;
  onRemove: (key: string) => void;
  accept?: string;
  multiple?: boolean;
  busy?: boolean;
  hint?: string;
  addLabel?: string;
  disabled?: boolean;
}

/**
 * The ONE upload control for every module — profile photos, product images,
 * payment proofs, expense receipts. Same square tiles, same dashed add-tile with
 * an upload-cloud icon, same drag-and-drop, same remove affordance everywhere,
 * so no two forms invent their own upload look. Single-file uses show one tile;
 * multi shows a gallery. Non-image files render as a labelled file chip.
 */
export function MediaUpload({
  items,
  onPick,
  onRemove,
  accept = "image/*",
  multiple = false,
  busy,
  hint,
  addLabel = "Upload",
  disabled,
}: MediaUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // Single-file controls hide the add-tile once a file is present (replace via
  // remove-then-add); multi always shows it.
  const showAdd = multiple || items.length === 0;

  function handleFiles(list: FileList | null) {
    const picked = list ? Array.from(list) : [];
    if (picked.length === 0) return;
    onPick(multiple ? picked : picked.slice(0, 1));
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        {items.map((it) => (
          <div
            key={it.key}
            className="relative size-24 rounded-xl border border-border bg-muted overflow-hidden shrink-0 shadow-sm"
          >
            {it.label ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-1 text-center">
                <FileText className="size-6 text-muted-foreground" />
                <span className="line-clamp-2 text-[9px] text-muted-foreground break-all">{it.label}</span>
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={it.url} alt="" className="h-full w-full object-cover" />
            )}
            {it.badge && (
              <span className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[9px] text-center py-0.5">
                {it.badge}
              </span>
            )}
            {!disabled && (
              <button
                type="button"
                onClick={() => onRemove(it.key)}
                className="absolute top-1 right-1 rounded-full bg-black/50 p-0.5 text-white hover:bg-black/70"
                aria-label="Remove"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        ))}

        {showAdd && (
          <label
            onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); if (!disabled) handleFiles(e.dataTransfer.files); }}
            className={cn(
              "size-24 rounded-xl border border-dashed flex flex-col items-center justify-center gap-1 bg-muted shrink-0 cursor-pointer transition-colors",
              dragOver ? "border-primary bg-primary/10" : "border-border hover:bg-muted/80 hover:border-primary/50",
              disabled && "opacity-50 cursor-not-allowed",
            )}
          >
            {busy ? (
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            ) : (
              <UploadCloud className="size-5 text-muted-foreground" />
            )}
            <span className="text-[10px] text-muted-foreground">{addLabel}</span>
            <input
              ref={inputRef}
              type="file"
              accept={accept}
              multiple={multiple}
              disabled={disabled}
              className="hidden"
              onChange={(e) => { const l = e.target.files; e.target.value = ""; handleFiles(l); }}
            />
          </label>
        )}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
