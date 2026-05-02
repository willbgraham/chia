import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getAdminClient } from "@/lib/supabase/admin";
import type { Lesson } from "@/types";
import { LessonEditClient } from "./LessonEditClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function LessonDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const sb = getAdminClient();
  const { data, error } = await sb
    .from("lessons")
    .select("*")
    .eq("id", params.id)
    .single();

  if (error || !data) notFound();
  const lesson = data as Lesson;

  return (
    <div className="p-8 max-w-6xl">
      <Link
        href="/admin/lessons"
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to lessons
      </Link>
      <h1 className="text-2xl font-semibold text-text">{lesson.title}</h1>
      <p className="mt-1 text-sm text-muted">
        {lesson.language} · {lesson.level} · #{lesson.lesson_number} · {lesson.topic}
      </p>

      <div className="mt-6">
        <LessonEditClient lesson={lesson} />
      </div>
    </div>
  );
}
