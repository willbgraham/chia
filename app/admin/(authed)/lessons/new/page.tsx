"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Input";
import {
  EMPTY_LESSON_CONTENT,
  LessonEditor,
} from "@/components/admin/LessonEditor";
import type { LessonContent } from "@/types";

export default function NewLessonPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState({
    language: "Spanish",
    level: "beginner",
    topic: "",
    lesson_number: "1",
    title: "",
  });
  const [content, setContent] = useState<LessonContent>(EMPTY_LESSON_CONTENT);

  function set<K extends keyof typeof meta>(key: K, value: string) {
    setMeta((m) => ({ ...m, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/lessons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...meta,
          lesson_number: Number(meta.lesson_number),
          content,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "create failed");
      }
      const j = (await res.json()) as { lesson: { id: string } };
      router.push(`/admin/lessons/${j.lesson.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-8 max-w-6xl">
      <Link
        href="/admin/lessons"
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to lessons
      </Link>
      <h1 className="text-2xl font-semibold text-text">New lesson</h1>

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Field label="Language">
            <Input
              required
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
              required
              value={meta.topic}
              onChange={(e) => set("topic", e.target.value)}
            />
          </Field>
          <Field label="Lesson #">
            <Input
              type="number"
              required
              value={meta.lesson_number}
              onChange={(e) => set("lesson_number", e.target.value)}
            />
          </Field>
          <Field label="Title">
            <Input
              required
              value={meta.title}
              onChange={(e) => set("title", e.target.value)}
            />
          </Field>
        </div>

        <LessonEditor initialContent={content} onChange={setContent} />

        <div className="flex items-center gap-3 pt-2">
          <Button type="submit" loading={busy}>
            Create lesson
          </Button>
          {error ? <span className="text-xs text-danger">{error}</span> : null}
        </div>
      </form>
    </div>
  );
}
