// Admin PDF preview page. Lists every PDF in the catalog with an
// inline iframe preview, a "Regenerate" button (no-op since PDFs are
// generated on-demand from data/pdf-content.json — but useful as a
// page refresh signal), and a download link.
//
// Edit the underlying content at data/pdf-content.json. Changes show
// up here immediately on page reload.

import type { Metadata } from "next";
import { listAvailablePDFs } from "@/lib/pdf";
import { PDFPreviewCard } from "./PDFPreviewCard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "PDFs",
};

export default function PDFsPage() {
  const entries = listAvailablePDFs();

  // Group by kind for visual organisation
  const verbConjugations = entries.filter(
    (e) => e.kind === "verb_conjugations",
  );
  const vocabSheets = entries.filter((e) => e.kind === "vocab_sheets");

  return (
    <div className="p-8 max-w-6xl">
      <h1 className="text-2xl font-semibold text-text">PDFs</h1>
      <p className="mt-1 text-sm text-muted">
        Preview every PDF Chia can send students. Edit copy at{" "}
        <code className="text-text font-mono text-xs">data/pdf-content.json</code>{" "}
        and reload this page to see the result.
      </p>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-text">
          Verb conjugations
          <span className="ml-2 text-xs text-muted">
            {verbConjugations.length}
          </span>
        </h2>
        <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {verbConjugations.map((entry) => (
            <PDFPreviewCard
              key={`${entry.kind}-${entry.subject}`}
              entry={entry}
            />
          ))}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-semibold text-text">
          Vocab cheat sheets
          <span className="ml-2 text-xs text-muted">{vocabSheets.length}</span>
        </h2>
        <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {vocabSheets.map((entry) => (
            <PDFPreviewCard
              key={`${entry.kind}-${entry.subject}`}
              entry={entry}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
