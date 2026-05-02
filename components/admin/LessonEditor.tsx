"use client";

import { useMemo, useState } from "react";
import type { LessonContent, LessonItem } from "@/types";
import { Field, Input, Textarea } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

interface LessonEditorProps {
  initialContent: LessonContent;
  onChange: (content: LessonContent) => void;
}

// JSON-first editor with a structured side-panel preview. The brief
// asked for a JSON editor + preview, so we let the user paste/edit
// raw JSON and show a parsed view alongside.
export function LessonEditor({ initialContent, onChange }: LessonEditorProps) {
  const [raw, setRaw] = useState<string>(() =>
    JSON.stringify(initialContent, null, 2),
  );
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo<LessonContent | null>(() => {
    try {
      const obj = JSON.parse(raw) as LessonContent;
      return obj;
    } catch {
      return null;
    }
  }, [raw]);

  function handleChange(value: string) {
    setRaw(value);
    try {
      const obj = JSON.parse(value) as LessonContent;
      onChange(obj);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "invalid JSON");
    }
  }

  function format() {
    if (!parsed) return;
    setRaw(JSON.stringify(parsed, null, 2));
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div>
        <Field label="Lesson content (JSON)" hint={error ?? "valid"}>
          <Textarea
            value={raw}
            onChange={(e) => handleChange(e.target.value)}
            rows={28}
            className="text-xs"
          />
        </Field>
        <div className="mt-2 flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={format} disabled={!parsed}>
            Format JSON
          </Button>
          {error ? (
            <span className="text-xs text-danger">{error}</span>
          ) : (
            <span className="text-xs text-success">parses cleanly</span>
          )}
        </div>
      </div>
      <LessonPreview content={parsed} />
    </div>
  );
}

function LessonPreview({ content }: { content: LessonContent | null }) {
  if (!content) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted">
        Preview unavailable — fix JSON to render.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border bg-surface p-4 space-y-4 max-h-[700px] overflow-y-auto scrollbar-thin">
      <div>
        <div className="text-xs uppercase tracking-wide text-muted">Intro</div>
        <p className="mt-1 text-sm text-text">{content.introduction}</p>
      </div>
      <div>
        <div className="text-xs uppercase tracking-wide text-muted">
          Items ({content.items?.length ?? 0})
        </div>
        <div className="mt-2 space-y-2">
          {content.items?.map((item, i) => <ItemRow key={i} item={item} />)}
        </div>
      </div>
      {content.summary ? (
        <div>
          <div className="text-xs uppercase tracking-wide text-muted">Summary</div>
          <p className="mt-1 text-sm text-text">{content.summary}</p>
        </div>
      ) : null}
      {content.practice_prompts?.length ? (
        <div>
          <div className="text-xs uppercase tracking-wide text-muted">
            Practice prompts
          </div>
          <ul className="mt-1 list-disc list-inside text-sm text-text space-y-0.5">
            {content.practice_prompts.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ItemRow({ item }: { item: LessonItem }) {
  return (
    <div className="rounded-md border border-border bg-bg p-3">
      <div className="flex items-center justify-between gap-2">
        <Badge tone="accent">{item.type}</Badge>
        {item.audio_worthy ? <Badge tone="success">audio</Badge> : null}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
        <div>
          <div className="text-xs text-muted">target</div>
          <div className="text-text font-medium">{item.target_language}</div>
        </div>
        <div>
          <div className="text-xs text-muted">native</div>
          <div className="text-text">{item.native_language}</div>
        </div>
      </div>
      {item.pronunciation_guide ? (
        <div className="mt-2 text-xs text-muted">
          <span className="text-muted">say: </span>
          <span className="font-mono text-text">{item.pronunciation_guide}</span>
        </div>
      ) : null}
      {item.notes ? (
        <div className="mt-1 text-xs text-muted italic">{item.notes}</div>
      ) : null}
      {item.conjugation ? (
        <table className="mt-2 w-full text-xs">
          <tbody>
            {Object.entries(item.conjugation).map(([k, v]) => (
              <tr key={k}>
                <td className="py-0.5 text-muted pr-2">{k}</td>
                <td className="py-0.5 text-text font-mono">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

// Empty content scaffold for the "new lesson" page.
export const EMPTY_LESSON_CONTENT: LessonContent = {
  introduction: "",
  items: [],
  summary: "",
  practice_prompts: [],
};
