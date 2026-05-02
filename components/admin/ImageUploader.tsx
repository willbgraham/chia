"use client";

import { useState, type ChangeEvent } from "react";
import { Upload } from "lucide-react";
import type { ImageContext, TeacherImage } from "@/types";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Input";

const CONTEXT_OPTIONS: ImageContext[] = [
  "morning",
  "evening",
  "happy",
  "thoughtful",
  "location",
  "lesson",
  "celebration",
  "correction",
  "greeting",
  "general",
];

interface ImageUploaderProps {
  teacherId: string;
  onUploaded: (created: TeacherImage[]) => void;
}

export function ImageUploader({ teacherId, onUploaded }: ImageUploaderProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [tags, setTags] = useState("");
  const [context, setContext] = useState<ImageContext | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const list = e.target.files;
    if (!list) return;
    setFiles(Array.from(list));
  }

  async function upload() {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("teacher_id", teacherId);
      if (tags) form.append("tags", tags);
      if (context) form.append("context", context);
      for (const f of files) form.append("files", f);

      const res = await fetch("/api/admin/images", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `upload failed (${res.status})`);
      }
      const j = (await res.json()) as { images: TeacherImage[] };
      onUploaded(j.images);
      setFiles([]);
      setTags("");
      setContext("");
      const fileInput = document.getElementById(
        "image-file-input",
      ) as HTMLInputElement | null;
      if (fileInput) fileInput.value = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : "upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="Files" htmlFor="image-file-input">
          <input
            id="image-file-input"
            type="file"
            multiple
            accept="image/*"
            onChange={onPick}
            className="block w-full text-sm text-muted file:mr-3 file:rounded-md file:border-0 file:bg-bg file:px-3 file:py-2 file:text-sm file:text-text hover:file:bg-border"
          />
        </Field>
        <Field label="Context (optional)" htmlFor="image-context">
          <select
            id="image-context"
            value={context}
            onChange={(e) => setContext(e.target.value as ImageContext | "")}
            className="w-full rounded-md bg-bg border border-border px-3 py-2 text-sm text-text"
          >
            <option value="">— none —</option>
            {CONTEXT_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tags (comma separated)" htmlFor="image-tags">
          <Input
            id="image-tags"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="happy, smiling, outdoors"
          />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={upload} loading={busy} disabled={files.length === 0}>
          <Upload className="h-4 w-4" />
          Upload {files.length > 0 ? `(${files.length})` : ""}
        </Button>
        {error ? <span className="text-xs text-danger">{error}</span> : null}
      </div>
    </div>
  );
}
