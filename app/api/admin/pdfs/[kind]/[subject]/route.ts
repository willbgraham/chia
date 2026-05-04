// Admin-only PDF preview endpoint. Generates the PDF on-demand
// and returns it inline (browser-renderable) so the admin can review
// before students get them via the bot.
//
// GET /api/admin/pdfs/<kind>/<subject>            → inline preview
// GET /api/admin/pdfs/<kind>/<subject>?download=1 → download

import { type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { generatePDF, type PDFEntry } from "@/lib/pdf";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: { kind: string; subject: string } },
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const kind = params.kind as PDFEntry["kind"];
  if (kind !== "verb_conjugations" && kind !== "vocab_sheets") {
    return new Response("invalid kind", { status: 400 });
  }

  let bytes: Uint8Array;
  try {
    bytes = await generatePDF(kind, params.subject);
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "error", {
      status: 400,
    });
  }

  const download = request.nextUrl.searchParams.get("download") === "1";
  const filename = `chiachat-${params.kind}-${params.subject}.pdf`;

  // Cast to BlobPart explicitly — TS gets confused by the
  // Uint8Array<ArrayBufferLike> generic from pdf-lib but the runtime
  // value is a perfectly valid BodyInit for the Response constructor.
  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
