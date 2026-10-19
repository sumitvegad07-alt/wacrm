import { describe, it, expect } from "vitest";
import {
  ACCEPT_ATTRIBUTE,
  ATTACHMENT_SLOTS,
  MAX_ATTACHMENT_BYTES,
  attachmentKind,
  checkUpload,
  orderAttachments,
  storagePath,
} from "./outreach-attachments";

describe("attachmentKind", () => {
  it("calls the three image types images, because WhatsApp shows those as photos", () => {
    expect(attachmentKind("image/jpeg")).toBe("image");
    expect(attachmentKind("image/png")).toBe("image");
    expect(attachmentKind("image/webp")).toBe("image");
  });

  it("calls a PDF a document", () => {
    expect(attachmentKind("application/pdf")).toBe("document");
  });

  it("ignores the charset browsers sometimes staple on", () => {
    expect(attachmentKind("application/pdf; charset=binary")).toBe("document");
  });

  it("is case-insensitive, because the browser is not consistent", () => {
    expect(attachmentKind("IMAGE/JPEG")).toBe("image");
  });

  it("refuses everything else", () => {
    // A .docx or a .zip would arrive as a file WhatsApp flags, and an
    // image/svg+xml is a script in a picture's clothing.
    expect(attachmentKind("image/svg+xml")).toBeNull();
    expect(attachmentKind("application/zip")).toBeNull();
    expect(attachmentKind("text/html")).toBeNull();
    expect(attachmentKind("")).toBeNull();
  });
});

describe("checkUpload", () => {
  const good = {
    slot: 1,
    mimeType: "image/png",
    sizeBytes: 1_000,
    fileName: "ozzo.png",
  };

  it("accepts an image and reports its kind", () => {
    const result = checkUpload(good);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.kind).toBe("image");
  });

  it("accepts a PDF in either slot", () => {
    // Slot 2 is where the PDF usually goes, but neither slot is typed: the
    // founder may want two pictures, or send the PDF first.
    for (const slot of ATTACHMENT_SLOTS) {
      const result = checkUpload({ ...good, slot, mimeType: "application/pdf" });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.kind).toBe("document");
    }
  });

  it("refuses a slot that does not exist", () => {
    expect(checkUpload({ ...good, slot: 3 }).ok).toBe(false);
    expect(checkUpload({ ...good, slot: 0 }).ok).toBe(false);
  });

  it("refuses a file type WhatsApp would not show properly", () => {
    const result = checkUpload({ ...good, mimeType: "application/zip" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/JPG|PNG|PDF/i);
  });

  it("refuses an empty file, which uploads fine and sends as nothing", () => {
    expect(checkUpload({ ...good, sizeBytes: 0 }).ok).toBe(false);
  });

  it("refuses a file past WhatsApp's own ceiling", () => {
    expect(checkUpload({ ...good, sizeBytes: MAX_ATTACHMENT_BYTES }).ok).toBe(true);
    const result = checkUpload({ ...good, sizeBytes: MAX_ATTACHMENT_BYTES + 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/16 MB/);
  });

  it("refuses a file with no name, because the name is what the prospect sees", () => {
    expect(checkUpload({ ...good, fileName: "   " }).ok).toBe(false);
  });
});

describe("storagePath", () => {
  it("puts each slot under its own prefix", () => {
    expect(storagePath(1, "ozzo.png")).toMatch(/^attachments\/slot-1\//);
    expect(storagePath(2, "ozzo.pdf")).toMatch(/^attachments\/slot-2\//);
  });

  it("never returns the same path twice, so a replacement cannot be served from cache", () => {
    expect(storagePath(1, "ozzo.png")).not.toBe(storagePath(1, "ozzo.png"));
  });

  it("strips anything that could walk out of the bucket or break a URL", () => {
    const path = storagePath(1, "../../etc/pass word#1.png");
    expect(path).not.toMatch(/\.\./);
    expect(path).not.toMatch(/[#?\s]/);
    expect(path.split("/").length).toBe(3);
  });

  it("keeps the extension, because Storage guesses the type from it", () => {
    expect(storagePath(2, "OZZO Brochure.pdf")).toMatch(/\.pdf$/);
  });

  it("survives a file with no extension at all", () => {
    const path = storagePath(1, "brochure");
    expect(path).toMatch(/^attachments\/slot-1\/.+/);
  });
});

describe("orderAttachments", () => {
  it("sorts by slot, because slot order is the order they are sent in", () => {
    const sorted = orderAttachments([
      { slot: 2, path: "b", file_name: "b.pdf", mime_type: "application/pdf", kind: "document" },
      { slot: 1, path: "a", file_name: "a.png", mime_type: "image/png", kind: "image" },
    ]);
    expect(sorted.map((a) => a.slot)).toEqual([1, 2]);
  });

  it("drops a row whose slot is not one we send", () => {
    const sorted = orderAttachments([
      { slot: 9, path: "x", file_name: "x.pdf", mime_type: "application/pdf", kind: "document" },
    ]);
    expect(sorted).toEqual([]);
  });

  it("returns an empty list for nothing, so a campaign with no files is normal", () => {
    expect(orderAttachments([])).toEqual([]);
    expect(orderAttachments(null)).toEqual([]);
  });
});

describe("ACCEPT_ATTRIBUTE", () => {
  it("offers the file picker exactly what checkUpload will accept", () => {
    for (const mime of ACCEPT_ATTRIBUTE.split(",")) {
      expect(attachmentKind(mime)).not.toBeNull();
    }
  });
});
