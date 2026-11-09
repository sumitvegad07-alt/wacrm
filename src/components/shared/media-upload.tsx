"use client";

import { useRef, useState } from "react";
import { UploadCloud, X, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { downscaleImage } from "@/lib/images/downscale";

/**
 * The ceiling every storage bucket in the product is configured with
 * (migration 030 and 20260929120000). A file over this is refused by Supabase
 * with a raw error after the whole upload has been sent, so it is checked here
 * instead — before the wait, with a sentence that says what to do.
 */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

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
  /** Shrinking a photo takes a moment; the add-tile shows a spinner meanwhile. */
  const [preparing, setPreparing] = useState(false);

  // Single-file controls hide the add-tile once a file is present (replace via
  // remove-then-add); multi always shows it.
  const showAdd = multiple || items.length === 0;

  /**
   * Takes files that have ALREADY been copied out of their FileList.
   *
   * See the file input's onChange below for why that copy has to happen at the
   * call site rather than here.
   */
  async function handleFiles(picked: File[]) {
    if (picked.length === 0) return;
    const chosen = multiple ? picked : picked.slice(0, 1);

    setPreparing(true);
    try {
      /**
       * Shrink photos before they are handed on.
       *
       * A picture off a phone is 5–12 MB, which is both over every bucket's
       * 5 MB ceiling and a minute of waiting on mobile data — the form just
       * sat on "Saving…". Nothing here is displayed larger than about 500px,
       * so the full-resolution original was never worth sending.
       */
      const prepared = await Promise.all(chosen.map((file) => downscaleImage(file)));

      // Whatever could not be shrunk (a PDF receipt, an iPhone HEIC this
      // browser cannot decode) is checked against the real limit and refused
      // HERE, with a reason, rather than after the upload has been sent.
      const tooBig = prepared.filter((f) => f.size > MAX_UPLOAD_BYTES);
      const usable = prepared.filter((f) => f.size <= MAX_UPLOAD_BYTES);

      for (const file of tooBig) {
        toast.error(
          `"${file.name}" is ${(file.size / 1048576).toFixed(1)} MB — the limit is 5 MB. ` +
            `Save it as a JPEG or PNG and try again.`,
        );
      }

      if (usable.length > 0) onPick(usable);
    } finally {
      setPreparing(false);
    }
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
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (!disabled) void handleFiles(e.dataTransfer.files ? Array.from(e.dataTransfer.files) : []);
            }}
            className={cn(
              "size-24 rounded-xl border border-dashed flex flex-col items-center justify-center gap-1 bg-muted shrink-0 cursor-pointer transition-colors",
              dragOver ? "border-primary bg-primary/10" : "border-border hover:bg-muted/80 hover:border-primary/50",
              disabled && "opacity-50 cursor-not-allowed",
            )}
          >
            {busy || preparing ? (
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            ) : (
              <UploadCloud className="size-5 text-muted-foreground" />
            )}
            <span className="text-[10px] text-muted-foreground">
              {preparing ? "Preparing…" : addLabel}
            </span>
            <input
              ref={inputRef}
              type="file"
              accept={accept}
              multiple={multiple}
              disabled={disabled}
              className="hidden"
              /**
               * Copy the files out BEFORE resetting the input.
               *
               * `e.target.files` is a LIVE FileList bound to the input, and
               * `e.target.value = ""` empties that very object — so the old
               * `const l = e.target.files; e.target.value = ""; handleFiles(l)`
               * handed on a list that had already become empty. Picking a file
               * through the file dialog did nothing at all: no preview tile,
               * and a save that reported success having uploaded nothing. This
               * is the shared upload control, so that was true of product
               * images, profile photos, payment proofs and expense receipts
               * alike. Dragging a file in still worked, which is what made it
               * look intermittent.
               *
               * The reset itself has to stay: without it, picking the SAME file
               * again fires no change event at all.
               */
              onChange={(e) => {
                const picked = e.target.files ? Array.from(e.target.files) : [];
                e.target.value = "";
                void handleFiles(picked);
              }}
            />
          </label>
        )}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
