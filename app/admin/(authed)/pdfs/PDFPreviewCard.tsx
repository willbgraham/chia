"use client";

import { useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import type { PDFEntry } from "@/lib/pdf";

// One card per available PDF in the catalog. Iframe-renders the
// admin preview endpoint. The cache-busting ?_t=<ts> query param on
// "Regenerate" forces a fresh fetch (the endpoint disables HTTP
// caching anyway, but some browsers respect Content-Disposition
// caching independently).

export function PDFPreviewCard({ entry }: { entry: PDFEntry }) {
  const [bust, setBust] = useState(0);
  const previewUrl = `/api/admin/pdfs/${entry.kind}/${entry.subject}?_t=${bust}`;
  const downloadUrl = `/api/admin/pdfs/${entry.kind}/${entry.subject}?download=1&_t=${bust}`;

  return (
    <div className="rounded-2xl border border-border bg-surface overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-text">{entry.title}</div>
          <div className="text-xs text-muted mt-0.5 line-clamp-2">
            {entry.subtitle}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setBust((b) => b + 1)}
            className="rounded-md border border-border bg-bg p-1.5 text-muted hover:text-text"
            title="Regenerate preview"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <a
            href={downloadUrl}
            className="rounded-md border border-border bg-bg p-1.5 text-muted hover:text-text"
            title="Download"
          >
            <Download className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
      <iframe
        src={previewUrl}
        className="w-full h-[600px] bg-white"
        title={entry.title}
      />
      <div className="px-4 py-2 text-[11px] text-muted font-mono border-t border-border">
        {entry.kind} / {entry.subject}
      </div>
    </div>
  );
}
