// Classify a student message → which PDF (if any) they want.
//
// Two-stage:
//   1. Cheap regex check for "PDF intent" keywords. Skip GPT call
//      entirely if no signal at all (most messages don't want a PDF).
//   2. GPT-4o-mini classifier given the catalog of available PDFs
//      and the student message. Returns {kind, subject} or null.

import { chatCompletion } from "@/lib/messaging/openai";
import { listAvailablePDFs, type PDFEntry } from "@/lib/pdf";

// Cheap pre-filter — if none of these surface in the student message,
// skip the GPT call. Tuned for false negatives (skip GPT) being fine
// vs false positives (ping GPT unnecessarily) being wasted ~$0.0001.
const PDF_KEYWORDS = [
  "pdf",
  "cheat sheet",
  "cheatsheet",
  "cheat-sheet",
  "table",
  "conjugation",
  "conjugate",
  "reference",
  "summary",
  "list",
  "chart",
  "send me",
  "give me",
  "download",
  "pickup line",
  "piropo",
  "joke",
];

export function maybeWantsPDF(message: string): boolean {
  const t = message.toLowerCase();
  return PDF_KEYWORDS.some((kw) => t.includes(kw));
}

export interface PDFPick {
  kind: PDFEntry["kind"];
  subject: string;
  // GPT's confidence — used to suppress low-quality matches.
  confidence: "high" | "medium" | "low";
}

// Run the GPT classifier. Returns null if no PDF in the catalog
// matches the student's request closely enough (confidence === low).
export async function pickPDFForRequest(
  studentMessage: string,
): Promise<PDFPick | null> {
  const catalog = listAvailablePDFs();
  if (catalog.length === 0) return null;

  const catalogList = catalog
    .map(
      (e) =>
        `- ${e.kind}/${e.subject}: ${e.title} — ${e.subtitle.slice(0, 100)}`,
    )
    .join("\n");

  const system = `You match a student's WhatsApp message to a single PDF from this catalog of available PDFs:

${catalogList}

The student is asking Chia (their Spanish teacher) to send them something — a cheat sheet, conjugation table, joke list, pickup lines, etc. Pick the BEST single match from the catalog above and respond with JSON:

{"kind": "<kind>", "subject": "<subject>", "confidence": "high" | "medium" | "low"}

- "high"   = the student explicitly asks for this exact thing ("send me ser conjugation", "give me dating phrases")
- "medium" = the student's request maps clearly to one item but not by name ("how do I flirt in Spanish?" → vocab_sheets/dating)
- "low"    = no item in the catalog reasonably matches; or the student is just chatting

If confidence is "low", still return the closest item — the caller will discard it. NEVER invent a kind/subject not in the catalog.`;

  let raw: string;
  try {
    raw = await chatCompletion(
      [
        { role: "system", content: system },
        { role: "user", content: studentMessage.slice(0, 500) },
      ],
      {
        temperature: 0,
        max_tokens: 60,
        response_format: { type: "json_object" },
      },
    );
  } catch (err) {
    console.error("[pdf-pick] classify failed:", err);
    return null;
  }

  let parsed: { kind?: string; subject?: string; confidence?: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  // Validate against the actual catalog — never return an invented match.
  const match = catalog.find(
    (e) => e.kind === parsed.kind && e.subject === parsed.subject,
  );
  if (!match) return null;
  if (parsed.confidence === "low") return null;

  return {
    kind: match.kind,
    subject: match.subject,
    confidence: parsed.confidence === "high" ? "high" : "medium",
  };
}
