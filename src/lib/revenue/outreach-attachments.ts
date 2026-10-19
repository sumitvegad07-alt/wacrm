// ============================================================
// What may be attached to an outreach message, and where it is kept.
//
// Pure rules, no Supabase, for the same reason outreach-policy.ts is pure:
// the upload route, the page and the campaign snapshot all have to agree on
// what a valid attachment is, and a rule that lives in three places is a rule
// that will one day accept a file in one of them and refuse it in the other
// two.
//
// WHY ONLY FOUR TYPES
//
// WhatsApp renders a JPG, PNG or WebP as a photo in the chat and a PDF as a
// document card with a preview. Everything else — .docx, .zip, .xlsx — arrives
// as an anonymous file, which is both what an unknown number sending a file
// looks like at its worst and what recipients are told never to open. An SVG
// is excluded separately: it is a script in a picture's clothing.
//
// WHY TWO SLOTS AND NOT A LIST
//
// Slot order is send order, and it has to survive being stored, re-read and
// replaced one file at a time. Two fixed slots make "replace the PDF" a write
// to one row, with no re-ordering and nothing to renumber. The founder asked
// for two; adding a third is one entry in ATTACHMENT_SLOTS and one more box on
// the page.
// ============================================================

/** The slots a campaign can carry, in the order they are sent. */
export const ATTACHMENT_SLOTS = [1, 2] as const;

export type AttachmentSlot = (typeof ATTACHMENT_SLOTS)[number];

/**
 * How WhatsApp should show the file. `image` becomes a photo in the chat,
 * `document` becomes a file card. This is handed straight to WA-JS's
 * sendFileMessage as its `type`.
 */
export type AttachmentKind = "image" | "document";

const KIND_BY_MIME: Record<string, AttachmentKind> = {
  "image/jpeg": "image",
  "image/jpg": "image",
  "image/png": "image",
  "image/webp": "image",
  "application/pdf": "document",
};

/** What the file picker offers. Kept in step with KIND_BY_MIME by a test. */
export const ACCEPT_ATTRIBUTE = "image/jpeg,image/png,image/webp,application/pdf";

/**
 * WhatsApp's own ceiling for a document is 16 MB after its encoding overhead.
 * Anything larger is rejected by WhatsApp itself, mid-send, as a failure the
 * founder would see as three dead-man-switch strikes rather than as a file
 * that was always too big.
 */
export const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024;

/** A stored attachment, as the campaign snapshot and the page both see it. */
export interface AttachmentRef {
  slot: AttachmentSlot;
  path: string;
  fileName: string;
  mimeType: string;
  kind: AttachmentKind;
}

/** The database row shape, which is snake_case and comes back untyped. */
interface AttachmentRowish {
  slot: number;
  path: string;
  file_name: string;
  mime_type: string;
  kind: string;
}

/**
 * The kind WhatsApp should use for a MIME type, or null if we will not send it.
 *
 * Browsers hand over `application/pdf; charset=binary` and occasionally shout
 * the type in capitals, so neither the parameters nor the case may matter.
 */
export function attachmentKind(mimeType: string): AttachmentKind | null {
  const base = String(mimeType ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  return KIND_BY_MIME[base] ?? null;
}

export type UploadCheck =
  | { ok: true; kind: AttachmentKind }
  | { ok: false; error: string };

/**
 * Everything that must be true before a file is written to the bucket.
 *
 * The error strings are shown to the founder as they are, so they say what to
 * do rather than what went wrong.
 */
export function checkUpload(input: {
  slot: number;
  mimeType: string;
  sizeBytes: number;
  fileName: string;
}): UploadCheck {
  if (!(ATTACHMENT_SLOTS as readonly number[]).includes(input.slot)) {
    return { ok: false, error: "There are only two attachment slots" };
  }
  if (!String(input.fileName ?? "").trim()) {
    return { ok: false, error: "That file has no name" };
  }

  const kind = attachmentKind(input.mimeType);
  if (!kind) {
    return {
      ok: false,
      error: "Only a JPG, PNG, WebP picture or a PDF can be attached",
    };
  }

  // Zero bytes uploads perfectly happily and then sends as nothing at all,
  // which looks to the prospect like a broken message from a stranger.
  if (!(input.sizeBytes > 0)) {
    return { ok: false, error: "That file is empty" };
  }
  if (input.sizeBytes > MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: "That file is bigger than 16 MB, which is WhatsApp's limit" };
  }

  return { ok: true, kind };
}

/**
 * Where a slot's file lives in the private `outreach` bucket.
 *
 * Unique every time on purpose. Overwriting one fixed path per slot would let
 * a signed URL minted for the previous file — they live ten minutes — serve
 * the new one, and would let a CDN or the browser hand back the old picture
 * after a replacement. A fresh path makes a replacement unambiguous, and the
 * old object is deleted by the caller once the new row is written.
 */
export function storagePath(slot: number, fileName: string): string {
  const raw = String(fileName ?? "");
  // Basename only: a browser will not send a path, but a scripted call might,
  // and `../` in an object key is a way out of the prefix.
  const base = raw.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot + 1) : "";

  const safe = (piece: string) =>
    piece
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);

  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const name = safe(stem) || "file";
  const suffix = safe(ext);

  return `attachments/slot-${slot}/${stamp}-${name}${suffix ? `.${suffix}` : ""}`;
}

/**
 * Stored rows as a send list: slot order, nothing we cannot send.
 *
 * Tolerant of junk because it reads a jsonb column snapshotted months ago and
 * a row the schema no longer recognises must not stop a campaign dead.
 */
export function orderAttachments(rows: unknown): AttachmentRef[] {
  if (!Array.isArray(rows)) return [];

  const refs: AttachmentRef[] = [];
  for (const raw of rows) {
    const row = raw as Partial<AttachmentRowish> & Partial<AttachmentRef>;
    const slot = Number(row?.slot);
    if (!(ATTACHMENT_SLOTS as readonly number[]).includes(slot)) continue;

    const path = String(row?.path ?? "");
    if (!path) continue;

    const mimeType = String(row?.mime_type ?? row?.mimeType ?? "");
    const kind = attachmentKind(mimeType);
    if (!kind) continue;

    refs.push({
      slot: slot as AttachmentSlot,
      path,
      fileName: String(row?.file_name ?? row?.fileName ?? ""),
      mimeType,
      kind,
    });
  }

  return refs.sort((a, b) => a.slot - b.slot);
}
