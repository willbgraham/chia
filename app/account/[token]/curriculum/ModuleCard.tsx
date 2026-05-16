"use client";

import { ChevronDown } from "lucide-react";
import type { ModuleSummary } from "@/lib/handlers/curriculum";
import { LessonCheckbox } from "./LessonCheckbox";

// Collapsible card for one module. Native <details> for collapse so
// progress is preserved if React state resets and so it works without
// JS for first paint. Defaults to expanded when the module is current
// or completed; collapsed when it's a "locked-ahead" upcoming module.

interface Props {
  token: string;
  module: ModuleSummary;
  index: number;
}

export function ModuleCard({ token, module, index }: Props) {
  const defaultOpen = module.isCurrent || module.isComplete;
  const dot = module.isComplete ? "✅" : module.isCurrent ? "🟢" : "○";
  const pct =
    module.totalLessons === 0
      ? 0
      : Math.round((module.completedLessons / module.totalLessons) * 100);

  return (
    <details
      open={defaultOpen}
      className="group rounded-2xl border border-border bg-surface overflow-hidden"
    >
      <summary
        className={
          "list-none cursor-pointer px-5 py-4 flex items-center gap-3 " +
          "hover:bg-bg/30 transition-colors " +
          (module.isCurrent ? "bg-accent/5" : "")
        }
      >
        <span className="text-lg leading-none">{dot}</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-text">
            Module {index + 1} — {module.name}
          </div>
          <div className="mt-0.5 text-xs text-muted">
            {module.completedLessons}/{module.totalLessons} done · {pct}%
          </div>
        </div>
        <ChevronDown
          className="h-4 w-4 text-muted shrink-0 transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>

      {module.description ? (
        <div className="px-5 pb-2 text-xs text-muted leading-relaxed">
          {module.description}
        </div>
      ) : null}

      <div className="px-3 pb-3 space-y-0.5">
        {module.lessons.length === 0 ? (
          <div className="px-3 py-2 text-xs text-muted">
            No lessons in this module yet.
          </div>
        ) : (
          module.lessons.map((lesson) => (
            <LessonCheckbox
              key={lesson.id}
              token={token}
              lessonId={lesson.id}
              title={lesson.title}
              initialCompleted={lesson.completed}
              isCurrent={lesson.current}
            />
          ))
        )}
      </div>
    </details>
  );
}
