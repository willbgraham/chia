"use client";

import { useState } from "react";
import type { ImageContext, TeacherImage } from "@/types";
import { ImageGrid } from "@/components/admin/ImageGrid";
import { ImageUploader } from "@/components/admin/ImageUploader";

interface Props {
  teacherId: string;
  initialImages: TeacherImage[];
}

export function TeacherImagePanel({ teacherId, initialImages }: Props) {
  const [images, setImages] = useState<TeacherImage[]>(initialImages);

  function onUploaded(created: TeacherImage[]) {
    setImages((prev) => [...created, ...prev]);
  }

  async function onUpdate(
    id: string,
    patch: { tags?: string[]; context?: ImageContext | null },
  ) {
    const res = await fetch(`/api/admin/images/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) return;
    const j = (await res.json()) as { image: TeacherImage };
    setImages((prev) => prev.map((i) => (i.id === id ? j.image : i)));
  }

  async function onDelete(id: string) {
    const res = await fetch(`/api/admin/images/${id}`, { method: "DELETE" });
    if (!res.ok) return;
    setImages((prev) => prev.filter((i) => i.id !== id));
  }

  return (
    <div className="space-y-4">
      <ImageUploader teacherId={teacherId} onUploaded={onUploaded} />
      <ImageGrid images={images} onUpdate={onUpdate} onDelete={onDelete} />
    </div>
  );
}
