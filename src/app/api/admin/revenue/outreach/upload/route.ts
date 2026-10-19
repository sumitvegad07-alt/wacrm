// ============================================================
// Outreach — the two standing attachments.
//
// Its own route because this one takes multipart/form-data, and the sibling
// route next door is a JSON `action` switch that cannot carry a file.
//
// WHY THE FILE GOES THROUGH THE SERVER AND NOT STRAIGHT TO STORAGE
//
// The `outreach` bucket is private and carries no RLS policies at all, like
// every other re_* object in this feature: the service role is the only way
// in, after requireFounder() has passed. Uploading from the browser would mean
// writing a storage policy — a second, weaker door into a bucket whose whole
// point is that a signed URL is the only way to read it.
//
// The rules about what may be attached live in outreach-attachments.ts, shared
// with the page so the file picker offers exactly what this will accept.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireFounder, serviceClient } from "@/lib/auth/superadmin";
import {
  MAX_ATTACHMENT_BYTES,
  checkUpload,
  storagePath,
} from "@/lib/revenue/outreach-attachments";

export const dynamic = "force-dynamic";

/** A 16 MB PDF over a domestic upstream is not a ten-second request. */
export const maxDuration = 120;

const BUCKET = "outreach";

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireFounder();
    const admin = serviceClient();

    const form = await req.formData().catch(() => null);
    if (!form) {
      return NextResponse.json({ error: "Send the file as a form upload" }, { status: 400 });
    }

    const slot = Number(form.get("slot"));
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Choose a file first" }, { status: 400 });
    }

    const check = checkUpload({
      slot,
      mimeType: file.type,
      sizeBytes: file.size,
      fileName: file.name,
    });
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: 400 });
    }

    // Belt and braces against a `size` that lied: the body is already in
    // memory by the time we get here, so this is the last honest measurement.
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      return NextResponse.json(
        { error: "That file is bigger than 16 MB, which is WhatsApp's limit" },
        { status: 400 },
      );
    }

    // Read before the write, so the old object can be removed after the new
    // row lands. The other order — delete first — leaves the slot pointing at
    // nothing if the upload then fails, and a running campaign holding that
    // path would fail every send until he noticed.
    const { data: previous } = await admin
      .from("re_outreach_attachments")
      .select("path")
      .eq("slot", slot)
      .maybeSingle()
      .throwOnError();

    const path = storagePath(slot, file.name);
    const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, bytes, {
      contentType: file.type,
      upsert: false,
    });
    if (uploadError) throw uploadError;

    try {
      await admin
        .from("re_outreach_attachments")
        .upsert(
          {
            slot,
            path,
            file_name: file.name.slice(0, 120),
            mime_type: file.type,
            kind: check.kind,
            size_bytes: bytes.byteLength,
            owner_id: ctx.userId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "slot" },
        )
        .throwOnError();
    } catch (rowFailure) {
      // The object is uploaded but nothing points at it. Clean up by hand, or
      // the bucket fills with files no campaign will ever send.
      await admin.storage
        .from(BUCKET)
        .remove([path])
        .then(
          () => undefined,
          () => undefined,
        );
      throw rowFailure;
    }

    // Best effort. A campaign created before this moment holds its own
    // snapshot of the OLD path, so removing the old object would break a
    // campaign that is still sending it — which is why this only runs for a
    // path nothing has snapshotted.
    if (previous?.path && previous.path !== path) {
      const { data: stillUsed } = await admin
        .from("re_outreach_campaigns")
        .select("id")
        .in("status", ["draft", "running", "paused"])
        .limit(50);
      const inUse = (stillUsed ?? []).length > 0;
      if (!inUse) {
        await admin.storage
          .from(BUCKET)
          .remove([previous.path])
          .then(
            () => undefined,
            () => undefined,
          );
      }
    }

    return NextResponse.json({
      slot,
      path,
      file_name: file.name,
      mime_type: file.type,
      kind: check.kind,
      size_bytes: bytes.byteLength,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * Clears a slot.
 *
 * The object is left in the bucket on purpose: a campaign created a minute ago
 * still holds that path in its snapshot and is still sending it. Storage is
 * cheap; a campaign that fails every send for the rest of its run is not.
 */
export async function DELETE(req: NextRequest) {
  try {
    await requireFounder();
    const admin = serviceClient();

    const slot = Number(new URL(req.url).searchParams.get("slot"));
    if (!Number.isInteger(slot)) {
      return NextResponse.json({ error: "Which slot?" }, { status: 400 });
    }

    await admin.from("re_outreach_attachments").delete().eq("slot", slot).throwOnError();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
