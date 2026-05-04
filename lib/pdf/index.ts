// PDF generation for ChiaChat. Uses pdf-lib (pure JS, works in Vercel
// serverless — no native deps). Each PDF "kind" has its own renderer.
//
// Content lives in data/pdf-content.json so non-engineer admins can
// edit copy without touching TS. Renderers transform that data into
// branded A4 PDFs.
//
// Brand:
//   - Background: warm white (#fafaf7)
//   - Body text: near-black (#1c1d22)
//   - Accent: ChiaChat coral-pink (#e85d75) — matches the web palette
//   - Footer: 🌿 ChiaChat — Made in Valencia / chiachat.com

import {
  PDFDocument,
  PDFFont,
  PDFPage,
  StandardFonts,
  rgb,
} from "pdf-lib";
import { readFileSync } from "node:fs";
import path from "node:path";

// ── Layout constants (A4 portrait at 72dpi) ────────────────────────
const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 48;

// Colors
const BG = rgb(0.98, 0.98, 0.97); // #fafaf7
const TEXT = rgb(0.11, 0.11, 0.13); // #1c1d22
const MUTED = rgb(0.5, 0.5, 0.55);
const ACCENT = rgb(0.91, 0.36, 0.46); // #e85d75
const ACCENT_BG = rgb(0.98, 0.92, 0.93);

// ── Content loader ─────────────────────────────────────────────────
let _content: PDFContentSchema | null = null;
function getContent(): PDFContentSchema {
  if (_content) return _content;
  const raw = readFileSync(
    path.join(process.cwd(), "data", "pdf-content.json"),
    "utf8",
  );
  _content = JSON.parse(raw) as PDFContentSchema;
  return _content;
}

// ── Schema (must match data/pdf-content.json) ──────────────────────
interface VerbConjugation {
  title: string;
  subtitle: string;
  tenses: { name: string; rows: [string, string][] }[];
  examples: [string, string][];
}
interface VocabSheet {
  title: string;
  subtitle: string;
  sections: { heading: string; rows: [string, string][] }[];
}
interface PDFContentSchema {
  verb_conjugations: Record<string, VerbConjugation>;
  vocab_sheets: Record<string, VocabSheet>;
}

// ── Public catalog ─────────────────────────────────────────────────
// What's available for Chia to send and for the admin to preview.
export interface PDFEntry {
  kind: "verb_conjugations" | "vocab_sheets";
  subject: string;
  title: string;
  subtitle: string;
  filename: string;
}
export function listAvailablePDFs(): PDFEntry[] {
  const c = getContent();
  const entries: PDFEntry[] = [];
  for (const subject of Object.keys(c.verb_conjugations)) {
    const e = c.verb_conjugations[subject];
    entries.push({
      kind: "verb_conjugations",
      subject,
      title: e.title,
      subtitle: e.subtitle,
      filename: `chiachat-${subject}-conjugation.pdf`,
    });
  }
  for (const subject of Object.keys(c.vocab_sheets)) {
    const e = c.vocab_sheets[subject];
    entries.push({
      kind: "vocab_sheets",
      subject,
      title: e.title,
      subtitle: e.subtitle,
      filename: `chiachat-${subject}.pdf`,
    });
  }
  return entries;
}

// ── Top-level dispatcher ───────────────────────────────────────────
export async function generatePDF(
  kind: PDFEntry["kind"],
  subject: string,
): Promise<Uint8Array> {
  const c = getContent();
  if (kind === "verb_conjugations") {
    const data = c.verb_conjugations[subject];
    if (!data) throw new Error(`unknown verb_conjugation: ${subject}`);
    return renderVerbConjugation(data);
  }
  if (kind === "vocab_sheets") {
    const data = c.vocab_sheets[subject];
    if (!data) throw new Error(`unknown vocab_sheet: ${subject}`);
    return renderVocabSheet(data);
  }
  throw new Error(`unknown PDF kind: ${kind}`);
}

// ── Renderers ──────────────────────────────────────────────────────

async function renderVerbConjugation(
  data: VerbConjugation,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${data.title} — ChiaChat`);
  doc.setAuthor("ChiaChat");

  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const helvObl = await doc.embedFont(StandardFonts.HelveticaOblique);

  const page = doc.addPage([PAGE_W, PAGE_H]);
  paintBackground(page);

  let y = drawHeader(page, helvBold, helv, data.title, data.subtitle);

  // 2x2 grid of tenses
  const colW = (PAGE_W - 2 * MARGIN - 16) / 2;
  const rowGap = 16;
  const tenseBoxH = 130;

  for (let i = 0; i < data.tenses.length; i++) {
    const tense = data.tenses[i];
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = MARGIN + col * (colW + 16);
    const yBox = y - row * (tenseBoxH + rowGap) - tenseBoxH;
    drawTenseBox(page, helvBold, helv, tense, x, yBox, colW, tenseBoxH);
  }

  y -= 2 * (tenseBoxH + rowGap) + 8;

  // Examples section
  page.drawText("In context", {
    x: MARGIN,
    y,
    size: 12,
    font: helvBold,
    color: ACCENT,
  });
  y -= 18;

  for (const [es, en] of data.examples) {
    page.drawText(es, {
      x: MARGIN,
      y,
      size: 11,
      font: helvBold,
      color: TEXT,
    });
    y -= 14;
    page.drawText(en, {
      x: MARGIN,
      y,
      size: 10,
      font: helvObl,
      color: MUTED,
    });
    y -= 22;
    if (y < 80) break;
  }

  drawFooter(page, helv);
  return doc.save();
}

async function renderVocabSheet(data: VocabSheet): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${data.title} — ChiaChat`);
  doc.setAuthor("ChiaChat");

  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const helvObl = await doc.embedFont(StandardFonts.HelveticaOblique);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  paintBackground(page);
  let y = drawHeader(page, helvBold, helv, data.title, data.subtitle);

  for (const section of data.sections) {
    if (y < 140) {
      drawFooter(page, helv);
      page = doc.addPage([PAGE_W, PAGE_H]);
      paintBackground(page);
      y = PAGE_H - MARGIN - 20;
    }

    // section heading
    page.drawText(section.heading, {
      x: MARGIN,
      y,
      size: 13,
      font: helvBold,
      color: ACCENT,
    });
    y -= 6;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_W - MARGIN, y },
      thickness: 0.5,
      color: ACCENT,
      opacity: 0.4,
    });
    y -= 18;

    for (const [es, en] of section.rows) {
      if (y < 80) {
        drawFooter(page, helv);
        page = doc.addPage([PAGE_W, PAGE_H]);
        paintBackground(page);
        y = PAGE_H - MARGIN - 20;
      }
      // Spanish
      const esLines = wrapText(es, helvBold, 11, PAGE_W - 2 * MARGIN);
      for (const line of esLines) {
        page.drawText(line, {
          x: MARGIN,
          y,
          size: 11,
          font: helvBold,
          color: TEXT,
        });
        y -= 14;
      }
      // English
      const enLines = wrapText(en, helvObl, 10, PAGE_W - 2 * MARGIN);
      for (const line of enLines) {
        page.drawText(line, {
          x: MARGIN,
          y,
          size: 10,
          font: helvObl,
          color: MUTED,
        });
        y -= 13;
      }
      y -= 6;
    }
    y -= 14;
  }

  drawFooter(page, helv);
  return doc.save();
}

// ── Building blocks ────────────────────────────────────────────────

function paintBackground(page: PDFPage): void {
  page.drawRectangle({
    x: 0,
    y: 0,
    width: PAGE_W,
    height: PAGE_H,
    color: BG,
  });
}

function drawHeader(
  page: PDFPage,
  bold: PDFFont,
  reg: PDFFont,
  title: string,
  subtitle: string,
): number {
  // Top accent bar
  page.drawRectangle({
    x: 0,
    y: PAGE_H - 6,
    width: PAGE_W,
    height: 6,
    color: ACCENT,
  });

  // Brand mark + title block
  let y = PAGE_H - MARGIN;
  page.drawText("🌿 ChiaChat", {
    x: MARGIN,
    y,
    size: 11,
    font: bold,
    color: MUTED,
  });
  y -= 28;

  page.drawText(title, {
    x: MARGIN,
    y,
    size: 28,
    font: bold,
    color: TEXT,
  });
  y -= 22;

  // subtitle (wrap)
  const subLines = wrapText(subtitle, reg, 11, PAGE_W - 2 * MARGIN);
  for (const line of subLines.slice(0, 2)) {
    page.drawText(line, {
      x: MARGIN,
      y,
      size: 11,
      font: reg,
      color: MUTED,
    });
    y -= 14;
  }
  y -= 14;
  return y;
}

function drawTenseBox(
  page: PDFPage,
  bold: PDFFont,
  reg: PDFFont,
  tense: { name: string; rows: [string, string][] },
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  // tinted background
  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    color: ACCENT_BG,
    borderColor: ACCENT,
    borderWidth: 0.4,
    borderOpacity: 0.4,
  });

  page.drawText(tense.name, {
    x: x + 12,
    y: y + h - 18,
    size: 10,
    font: bold,
    color: ACCENT,
  });

  let cy = y + h - 36;
  const lineH = 13;
  for (const [pron, form] of tense.rows) {
    if (cy < y + 6) break;
    page.drawText(pron, {
      x: x + 12,
      y: cy,
      size: 9,
      font: reg,
      color: MUTED,
    });
    page.drawText(form, {
      x: x + w - 12 - reg.widthOfTextAtSize(form, 10),
      y: cy,
      size: 10,
      font: bold,
      color: TEXT,
    });
    cy -= lineH;
  }
}

function drawFooter(page: PDFPage, reg: PDFFont): void {
  const text = "🌿 ChiaChat — Made in Valencia · chiachat.com";
  const w = reg.widthOfTextAtSize(text, 9);
  page.drawText(text, {
    x: (PAGE_W - w) / 2,
    y: 24,
    size: 9,
    font: reg,
    color: MUTED,
  });
}

// Word-wrap a string to fit within `maxWidth` at the given font/size.
// Returns lines that, when drawn, won't overflow horizontally.
function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}
