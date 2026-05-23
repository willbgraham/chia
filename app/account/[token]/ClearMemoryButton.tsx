"use client";

import { useState } from "react";
import { Trash2, Loader2, CheckCircle2 } from "lucide-react";

// Student-initiated "Clear what Chia remembers" button. Soft-deletes
// memory impressions (interests, mistakes, recent buffer, semantic
// embeddings) while keeping structural settings (name, level, etc).
// Two-step confirmation since this is a destructive action.

export function ClearMemoryButton({ token }: { token: string }) {
  const [stage, setStage] = useState<"idle" | "confirming" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onConfirm() {
    setStage("loading");
    setError(null);
    try {
      const res = await fetch(
        `/api/account/${encodeURIComponent(token)}/memory`,
        { method: "POST" },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `failed (${res.status})`);
      }
      setStage("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
      setStage("error");
    }
  }

  if (stage === "done") {
    return (
      <div className="rounded-2xl border border-success/30 bg-success/10 p-5">
        <div className="flex items-center gap-2.5 text-sm text-text">
          <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
          <span>
            Cleared 🌿 — Chia will get to know you again from your next
            conversation.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="text-xs uppercase tracking-wide text-muted mb-2">
        Privacy
      </div>
      <div className="text-sm text-text">Clear what Chia remembers</div>
      <p className="mt-1 text-xs text-muted leading-relaxed">
        Wipes everything she&apos;s learned about you from past chats —
        your interests, conversational notes, language progress, recent
        message history. Your name, level, and course progress stay the
        same. You don&apos;t have to re-onboard.
      </p>

      {stage === "idle" ? (
        <button
          type="button"
          onClick={() => setStage("confirming")}
          className="mt-4 inline-flex items-center gap-2 rounded-full border border-border bg-bg px-4 py-2 text-xs text-text hover:text-danger hover:border-danger/50"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete Chia&apos;s memory
        </button>
      ) : null}

      {stage === "confirming" ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-text">Are you sure?</span>
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex items-center gap-1.5 rounded-full bg-danger px-4 py-2 text-xs font-semibold text-bg hover:opacity-90"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Yes, delete
          </button>
          <button
            type="button"
            onClick={() => setStage("idle")}
            className="rounded-full border border-border bg-bg px-4 py-2 text-xs text-muted hover:text-text"
          >
            Cancel
          </button>
        </div>
      ) : null}

      {stage === "loading" ? (
        <div className="mt-4 inline-flex items-center gap-2 text-xs text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Clearing…
        </div>
      ) : null}

      {stage === "error" ? (
        <div className="mt-4 text-xs text-danger">
          Couldn&apos;t clear: {error}
        </div>
      ) : null}
    </div>
  );
}
