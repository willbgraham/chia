"use client";

import { useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";

// A single lesson row with a click-to-toggle completion checkbox.
// Optimistically updates the UI, then POSTs to the API. Rolls back
// on error.

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

  return (
    <button
      type="button"
      onClick={toggle}
      className={
        "group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors " +
        (isCurrent
          ? "bg-accent/10 border border-accent/30 hover:bg-accent/15"
          : "border border-transparent hover:bg-bg")
      }
    >
      <span
        className={
          "flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors " +
          (completed
            ? "bg-accent border-accent text-bg"
            : "border-border bg-bg group-hover:border-muted")
        }
        aria-hidden
      >
        {isPending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : completed ? (
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        ) : null}
      </span>
      <span
        className={
          "flex-1 leading-snug " +
          (completed ? "text-muted line-through" : "text-text")
        }
      >
        {title}
        {isCurrent ? (
          <span className="ml-2 text-[10px] uppercase tracking-wide text-accent">
            current
          </span>
        ) : null}
      </span>
      {error ? (
        <span className="text-xs text-danger">!</span>
      ) : null}
    </button>
  );
}
