/**
 * Shrink a picked image before it is uploaded.
 *
 * A photo straight off a phone is 5–12 MB. Product images are displayed at
 * 500×500, visit photos and expense receipts smaller still, so every byte past
 * about 1600px is paid for twice — once on the rep's mobile data, and again
 * every time the picture is shown.
 *
 * What it cost before: picking an 8.7 MB photo on the product form left "Saving…"
 * spinning for a minute with no progress and no error — the founder's "product
 * image upload has some error nothing move ahead". It is also over the
 * product-images bucket's 5 MB ceiling (migration 030), so on a slow link the
 * reward for waiting was a raw storage error.
 *
 * After this, the same photo uploads as roughly 200–400 KB.
 *
 * Anything that is not a decodable raster image — a PDF receipt, an SVG, an
 * animated GIF, an iPhone HEIC the browser cannot read — is handed back
 * untouched. The caller's size check is what then reports a clear reason.
 */

export interface DownscaleOptions {
  /** Longest edge, in pixels, of the result. */
  maxEdge?: number;
  /** Encoder quality, 0–1. */
  quality?: number;
  /** Files at or under this size are left alone entirely. */
  skipUnderBytes?: number;
}

const DEFAULTS: Required<DownscaleOptions> = {
  maxEdge: 1600,
  quality: 0.85,
  // A quarter-megabyte image is already small enough that re-encoding it
  // would cost quality for no meaningful saving.
  skipUnderBytes: 256 * 1024,
};

/** Formats canvas must not touch: vector, animated, or not an image at all. */
function isReEncodable(file: File): boolean {
  if (!file.type.startsWith("image/")) return false;
  // An SVG re-encoded to a bitmap stops being a logo that scales; a GIF loses
  // its animation. Neither is ever large enough to be worth it.
  return file.type !== "image/svg+xml" && file.type !== "image/gif";
}

/** The best format this browser can encode to, preferring WebP. */
async function pickOutput(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  const webp = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", quality),
  );
  // Safari used to return null here rather than throwing. Fall back to JPEG,
  // which every browser can encode and the storage buckets accept.
  if (webp && webp.type === "image/webp") return webp;
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/** Decode a file to something canvas can draw, or null when it cannot be read. */
async function decode(file: File): Promise<ImageBitmap | HTMLImageElement | null> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // Fall through — Safari has historically refused some valid files here.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  } finally {
    // Revoked after decode: the bitmap has been copied into the element.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function replaceExtension(name: string, blobType: string): string {
  const ext = blobType === "image/webp" ? "webp" : "jpg";
  const base = name.replace(/\.[^./\\]+$/, "") || "image";
  return `${base}.${ext}`;
}

/**
 * The shrunk file, or the original when shrinking is impossible or pointless.
 * Never throws: a file that cannot be processed must still reach the caller,
 * which decides whether to accept it.
 */
export async function downscaleImage(file: File, options: DownscaleOptions = {}): Promise<File> {
  const { maxEdge, quality, skipUnderBytes } = { ...DEFAULTS, ...options };

  if (typeof document === "undefined") return file;
  if (!isReEncodable(file)) return file;

  try {
    const source = await decode(file);
    if (!source) return file;

    const width = "width" in source ? source.width : 0;
    const height = "height" in source ? source.height : 0;
    if (!width || !height) return file;

    const scale = Math.min(1, maxEdge / Math.max(width, height));
    // Already small in both dimensions AND in bytes — nothing to gain.
    if (scale === 1 && file.size <= skipUnderBytes) {
      if ("close" in source) source.close();
      return file;
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    // White underneath, so a transparent PNG re-encoded as JPEG comes out on
    // white rather than black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source as CanvasImageSource, 0, 0, canvas.width, canvas.height);
    if ("close" in source) source.close();

    const blob = await pickOutput(canvas, quality);
    if (!blob) return file;
    // Re-encoding can make an already-optimised file bigger. Keep whichever wins.
    if (blob.size >= file.size) return file;

    return new File([blob], replaceExtension(file.name, blob.type), {
      type: blob.type,
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}
