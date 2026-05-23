// Magic-byte sniffing for uploaded files. We never trust the
// client-declared MIME type — an attacker (or a misconfigured tool)
// could send a .png upload that's actually HTML or SVG with an
// embedded script, which becomes an XSS lure if the storage bucket
// is ever served with the wrong Content-Type or made public.
//
// Used by /api/admin/images and /api/admin/teachers/[id]/profile-image.

export type AllowedImageMime =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/gif";

// Inspect the first few bytes of a file and return the actual MIME
// type if it's one of our allow-list image formats. Returns null for
// anything else — including SVG (XSS vector), HTML, PDF, EXE, etc.
export function sniffImageMime(buf: Uint8Array): AllowedImageMime | null {
  if (buf.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "image/webp";
  }
  // GIF: "GIF87a" or "GIF89a"
  if (
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38 &&
    (buf[4] === 0x37 || buf[4] === 0x39) &&
    buf[5] === 0x61
  ) {
    return "image/gif";
  }
  return null;
}

// Same but accepts an ArrayBuffer directly (what request.formData()
// gives us via file.arrayBuffer()).
export function sniffImageMimeFromArrayBuffer(
  buf: ArrayBuffer,
): AllowedImageMime | null {
  return sniffImageMime(new Uint8Array(buf, 0, Math.min(buf.byteLength, 32)));
}

// Hard cap on admin image upload size — 10MB. Anything larger is a
// mistake or an attack. (Hero images compress to <1MB; we keep
// headroom for legitimate high-res photography uploads.)
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
