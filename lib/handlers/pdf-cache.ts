// Generate-or-cache pattern for PDFs Chia sends to students.
// Mirrors lib/messaging/audio-cache.ts in spirit.
//
// PDFs are deterministic — same kind+subject always produces the
// same bytes — so we generate once, upload to Supabase Storage,
// and reuse the public URL on every send. Cheap on serverless
// CPU + bandwidth.
//
// Bump CACHE_VERSION when you change pdf rendering or content
// shape so the next call regenerates rather than serving a stale
// cached file.

import crypto from "crypto";
import { getAdminClient } from "@/lib/supabase/admin";
import { generatePDF, type PDFEntry } from "@/lib/pdf";

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "chiachat-media";
const CACHE_PREFIX = "pdfs";

// Bump when PDF rendering changes meaningfully. Old cached PDFs
// become orphaned (manual cleanup via Supabase dashboard).
const CACHE_VERSION = "v1";

function cacheKey(kind: string, subject: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(`${CACHE_VERSION}::${kind}::${subject}`)
    .digest("hex")
    .slice(0, 16);
  return `${CACHE_PREFIX}/${kind}/${subject}-${hash}.pdf`;
}

export interface PDFAsset {
  publicUrl: string;
  filename: string;
  fromCache: boolean;
}

// Returns a public URL to the PDF for (kind, subject). Generates +
// uploads if not yet cached. Bucket is public so the URL goes
// directly to Meta sendDocument with no signed-URL gymnastics.
export async function getOrGeneratePDF(
  kind: PDFEntry["kind"],
  subject: string,
): Promise<PDFAsset> {
  const sb = getAdminClient();
  const key = cacheKey(kind, subject);
  const filename = `chiachat-${subject.replace(/_/g, "-")}.pdf`;

  // Cache hit?
  const { data: existing } = await sb.storage
    .from(BUCKET)
    .list(key.split("/").slice(0, -1).join("/"), {
      search: key.split("/").pop(),
    });
  if (existing && existing.length > 0) {
    const { data } = sb.storage.from(BUCKET).getPublicUrl(key);
    return { publicUrl: data.publicUrl, filename, fromCache: true };
  }

  // Cache miss → generate, upload, return.
  const bytes = await generatePDF(kind, subject);
  // Cast: pdf-lib's Uint8Array is fine for Supabase upload at runtime.
  const { error: upErr } = await sb.storage
    .from(BUCKET)
    .upload(key, bytes as unknown as Buffer, {
      contentType: "application/pdf",
      upsert: true,
    });
  if (upErr) {
    throw new Error(`pdf upload failed: ${upErr.message}`);
  }

  const { data } = sb.storage.from(BUCKET).getPublicUrl(key);
  return { publicUrl: data.publicUrl, filename, fromCache: false };
}
