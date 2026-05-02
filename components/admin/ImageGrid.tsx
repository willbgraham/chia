"use client";

import { useState } from "react";
import { Trash2, Tag } from "lucide-react";
import type { TeacherImage, ImageContext } from "@/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

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

interface ImageGridProps {
  images: TeacherImage[];
  onUpdate: (id: string, patch: { tags?: string[]; context?: ImageContext | null }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function ImageGrid({ images, onUpdate, onDelete }: ImageGridProps) {
  const [filterContext, setFilterContext] = useState<string>("");
  const [filterTag, setFilterTag] = useState<string>("");

  const filtered = images.filter((img) => {
    if (filterContext && img.context !== filterContext) return false;
    if (filterTag && !img.tags.includes(filterTag)) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <select
          value={filterContext}
          onChange={(e) => setFilterContext(e.target.value)}
          className="rounded-md bg-surface border border-border px-3 py-2 text-sm text-text"
        >
          <option value="">All contexts</option>
          {CONTEXT_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <Input
          placeholder="Filter by tag…"
          value={filterTag}
          onChange={(e) => setFilterTag(e.target.value)}
          className="max-w-xs"
        />
        <span className="text-xs text-muted">
          {filtered.length} of {images.length}
        </span>
      </div>
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted">
          No images yet — upload some above.
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {filtered.map((img) => (
            <ImageCard
              key={img.id}
              image={img}
              onUpdate={onUpdate}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ImageCard({
  image,
  onUpdate,
  onDelete,
}: {
  image: TeacherImage;
  onUpdate: ImageGridProps["onUpdate"];
  onDelete: ImageGridProps["onDelete"];
}) {
  const [tags, setTags] = useState(image.tags.join(", "));
  const [context, setContext] = useState<ImageContext | "">(image.context ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await onUpdate(image.id, {
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        context: context === "" ? null : (context as ImageContext),
      });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm("Delete this image?")) return;
    setDeleting(true);
    try {
      await onDelete(image.id);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <div className="relative aspect-square bg-bg">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.storage_url}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
      </div>
      <div className="p-3 space-y-2">
        <select
          value={context}
          onChange={(e) => setContext(e.target.value as ImageContext | "")}
          className="w-full rounded bg-bg border border-border px-2 py-1.5 text-xs text-text"
        >
          <option value="">no context</option>
          {CONTEXT_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="tag1, tag2"
          className="w-full rounded bg-bg border border-border px-2 py-1.5 text-xs text-text font-mono"
        />
        <div className="flex items-center justify-between gap-2">
          <Button size="sm" variant="secondary" onClick={save} loading={saving}>
            <Tag className="h-3 w-3" />
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={remove} loading={deleting}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
        {image.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1 pt-1">
            {image.tags.map((t) => (
              <Badge key={t} tone="neutral">
                {t}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

