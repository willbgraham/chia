"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Save, Trash2 } from "lucide-react";
import type { Lesson, LessonContent } from "@/types";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Input";
import { LessonEditor } from "@/components/admin/LessonEditor";

interface Props {
  lesson: Lesson;
}

export function LessonEditClient({ lesson }: Props) {
  const router = useRouter();
  const [meta, setMeta] = useState({
    language: lesson.language,
    level: lesson.level,
    topic: lesson.topic,
    lesson_number: String(lesson.lesson_number),
    title: lesson.title,
  });
  const [content, setContent] = useState<LessonContent>(lesson.content);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function set<K extends keyof typeof meta>(key: K, value: string) {
    setMeta((m) => ({ ...m, [key]: value }));
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/lessons/${lesson.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...meta,
          lesson_number: Number(meta.lesson_number),
          content,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "save failed");
      }
      setMsg({ ok: true, text: "Saved." });
    } catch (err) {
      setMsg({
        ok: false,
        text: err instanceof Error ? err.message : "save failed",
      });
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!confirm(`Delete lesson "${lesson.title}"?`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/lessons/${lesson.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("delete failed");
      router.push("/admin/lessons");
      router.refresh();
    } catch (err) {
      setMsg({
        ok: false,
        text: err instanceof Error ? err.message : "delete failed",
      });
      setDeleting(false);
    }
  }

  return (
    <form onSubmit={onSave} className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Field label="Language">
          <Input
            value={meta.language}
            onChange={(e) => set("language", e.target.value)}
          />
        </Field>
        <Field label="Level">
          <select
            value={meta.level}
            onChange={(e) => set("level", e.target.value)}
            className="w-full rounded-md bg-surface border border-border px-3 py-2 text-sm text-text"
          >
            <option value="beginner">beginner</option>
            <option value="intermediate">intermediate</option>
            <option value="advanced">advanced</option>
          </select>
        </Field>
        <Field label="Topic">
          <Input
            value={meta.topic}
            onChange={(e) => set("topic", e.target.value)}
          />
        </Field>
        <Field label="Lesson #">
          <Input
            type="number"
            value={meta.lesson_number}
            onChange={(e) => set("lesson_number", e.target.value)}
          />
        </Field>
        <Field label="Title">
          <Input
            value={meta.title}
            onChange={(e) => set("title", e.target.value)}
          />
        </Field>
      </div>

      <LessonEditor initialContent={content} onChange={setContent} />

      <div className="flex items-center justify-between pt-2">
        <div className="flex items-center gap-3">
          <Button type="submit" loading={busy}>
            <Save className="h-4 w-4" />
            Save
          </Button>
          {msg ? (
            <span
              className={
                msg.ok ? "text-xs text-success" : "text-xs text-danger"
              }
            >
              {msg.text}
            </span>
          ) : null}
        </div>
        <Button
          type="button"
          variant="danger"
          onClick={onDelete}
          loading={deleting}
        >
          <Trash2 className="h-4 w-4" />
          Delete lesson
        </Button>
      </div>
    </form>
  );
}
