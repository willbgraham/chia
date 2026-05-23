"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, Play, RotateCcw } from "lucide-react";

// A single lesson row with two actions:
//   1. Toggle checkbox — marks lesson complete / re-learn
//   2. "Learn" / "Relearn" button — sets curriculum_position to this
//      lesson and deep-links into WhatsApp so Chia starts it
//
// Both actions go through their own API endpoints with the magic
// link token in the path.

interface Props {
  token: string;
  lessonId: string;
  title: string;
  initialCompleted: boolean;
  isCurrent: boolean;
}

export function LessonCheckbox({
  token,
  lessonId,
  title,
  initialCompleted,
  isCurrent,
}: Props) {
  const [completed, setCompleted] = useState(initialCompleted);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [launching, setLaunching] = useState(false);

  function toggle() {
    if (isPending) return;
    const next = !completed;
    const prev = completed;
    setCompleted(next); // optimistic
    setError(null);

    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/account/${encodeURIComponent(token)}/lesson-progress`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lesson_id: lessonId, completed: next }),
          },
        );
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `update failed (${res.status})`);
        }
      } catch (e) {
        setCompleted(prev); // rollback
        setError(e instanceof Error ? e.message : "update failed");
      }
    });
  }

  async function launchLesson() {
    if (launching) return;
    setLaunching(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/account/${encodeURIComponent(token)}/start-lesson`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lesson_id: lessonId }),
        },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `failed (${res.status})`);
      }
      const j = (await res.json()) as { url: string };
      // Tiny pause so the user sees the loader register, then bounce
      // to WhatsApp. window.location keeps the back-button behavior
      // intact if they come back to the dashboard.
      window.location.href = j.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
      setLaunching(false);
    }
  }

  return (
    <div
      className={
        "group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors " +
        (isCurrent
          ? "bg-accent/10 border border-accent/30"
          : "border border-transparent hover:bg-bg")
      }
    >
      {/* Checkbox */}
      <button
        type="button"
        onClick={toggle}
        aria-label={completed ? "Mark as not done" : "Mark as done"}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors"
        style={{
          backgroundColor: completed ? "var(--accent, #e85d75)" : undefined,
          borderColor: completed ? "var(--accent, #e85d75)" : undefined,
          color: completed ? "var(--bg, #0b0d10)" : undefined,
        }}
      >
        {isPending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : completed ? (
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        ) : null}
      </button>

      {/* Title — also clickable to toggle (bigger tap target) */}
      <button
        type="button"
        onClick={toggle}
        className="flex-1 text-left leading-snug"
      >
        <span className={completed ? "text-muted line-through" : "text-text"}>
          {title}
        </span>
        {isCurrent ? (
          <span className="ml-2 text-[10px] uppercase tracking-wide text-accent">
            current
          </span>
        ) : null}
      </button>

      {/* Learn / Relearn launch button */}
      <button
        type="button"
        onClick={launchLesson}
        disabled={launching}
        className={
          "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-colors " +
          (completed
            ? "border border-border bg-bg text-muted hover:text-text hover:border-muted"
            : "bg-accent text-bg hover:opacity-90") +
          (launching ? " opacity-60 cursor-wait" : "")
        }
        title={
          completed
            ? "Relearn this lesson with Chia"
            : "Start this lesson with Chia"
        }
      >
        {launching ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : completed ? (
          <>
            <RotateCcw className="h-3 w-3" />
            Relearn
          </>
        ) : (
          <>
            <Play className="h-3 w-3" />
            Learn
          </>
        )}
      </button>

      {error ? <span className="text-xs text-danger">!</span> : null}
    </div>
  );
}
