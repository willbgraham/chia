"use client";

import { useState } from "react";
import { Star, Loader2, CheckCircle2, MessageSquare } from "lucide-react";

// Student-side feedback form. Optional 1-5 star rating + required
// free-text body. POSTs to /api/account/[token]/feedback. Returns to
// the idle state ~3s after success so a student who wants to send
// follow-up thoughts can do so without a page reload.

const MAX_BODY = 4000;

export function FeedbackForm({ token }: { token: string }) {
  const [rating, setRating] = useState<number | null>(null);
  const [body, setBody] = useState("");
  const [hover, setHover] = useState<number | null>(null);
  const [stage, setStage] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (body.trim().length === 0) {
      setError("Please write a note before submitting.");
      setStage("error");
      return;
    }
    setStage("loading");
    setError(null);
    try {
      const res = await fetch(
        `/api/account/${encodeURIComponent(token)}/feedback`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rating,
            body: body.trim(),
          }),
        },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `failed (${res.status})`);
      }
      setStage("done");
      // Reset fields after a beat so the student can send another note.
      setTimeout(() => {
        setRating(null);
        setBody("");
        setStage("idle");
      }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
      setStage("error");
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="text-xs uppercase tracking-wide text-muted mb-2">
        Feedback
      </div>
      <div className="flex items-center gap-2 text-sm text-text">
        <MessageSquare className="h-4 w-4 text-accent" />
        Tell us how it&apos;s going
      </div>
      <p className="mt-1 text-xs text-muted leading-relaxed">
        What&apos;s working? What&apos;s missing? Anything you wish Chia did
        differently? Your notes go straight to the team.
      </p>

      <form onSubmit={onSubmit} className="mt-4 space-y-3">
        {/* Star rating (optional) */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">Rating</span>
          <div
            className="flex items-center gap-0.5"
            onMouseLeave={() => setHover(null)}
          >
            {[1, 2, 3, 4, 5].map((n) => {
              const filled = (hover ?? rating ?? 0) >= n;
              return (
                <button
                  key={n}
                  type="button"
                  aria-label={`${n} star${n === 1 ? "" : "s"}`}
                  onMouseEnter={() => setHover(n)}
                  onClick={() => setRating(rating === n ? null : n)}
                  className="p-0.5 hover:scale-110 transition-transform"
                >
                  <Star
                    className={
                      "h-5 w-5 " +
                      (filled
                        ? "fill-accent text-accent"
                        : "text-muted")
                    }
                  />
                </button>
              );
            })}
          </div>
          {rating !== null ? (
            <button
              type="button"
              onClick={() => setRating(null)}
              className="text-xs text-muted hover:text-text"
            >
              Clear
            </button>
          ) : (
            <span className="text-xs text-muted">(optional)</span>
          )}
        </div>

        {/* Free-text body */}
        <div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY))}
            placeholder="Type what's on your mind — bugs, feature ideas, things you love, anything."
            rows={4}
            className="w-full rounded-lg bg-bg border border-border px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-none focus:border-accent resize-none"
            disabled={stage === "loading"}
          />
          <div className="mt-1 flex items-center justify-between">
            <span className="text-[10px] text-muted">
              {body.length}/{MAX_BODY}
            </span>
          </div>
        </div>

        {/* Actions + state */}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={stage === "loading" || body.trim().length === 0}
            className="inline-flex items-center gap-2 rounded-full bg-accent text-bg px-4 py-2 text-xs font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {stage === "loading" ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Sending…
              </>
            ) : (
              <>Send feedback</>
            )}
          </button>

          {stage === "done" ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-success">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Thank you — got it!
            </span>
          ) : null}

          {stage === "error" && error ? (
            <span className="text-xs text-danger">{error}</span>
          ) : null}
        </div>
      </form>
    </div>
  );
}
