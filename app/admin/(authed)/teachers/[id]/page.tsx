import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getAdminClient } from "@/lib/supabase/admin";
import type { Teacher, TeacherImage } from "@/types";
import { TeacherEditForm } from "./TeacherEditForm";
import { TeacherImagePanel } from "./TeacherImagePanel";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function TeacherDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const sb = getAdminClient();

  const [teacherRes, imagesRes] = await Promise.all([
    sb.from("teachers").select("*").eq("id", params.id).single(),
    sb
      .from("teacher_images")
      .select("*")
      .eq("teacher_id", params.id)
      .order("created_at", { ascending: false }),
  ]);

  if (teacherRes.error || !teacherRes.data) {
    notFound();
  }

  const teacher = teacherRes.data as Teacher;
  const images = (imagesRes.data ?? []) as TeacherImage[];

  return (
    <div className="p-8 max-w-5xl">
      <Link
        href="/admin/teachers"
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to teachers
      </Link>

      <h1 className="text-2xl font-semibold text-text">{teacher.name}</h1>
      <p className="mt-1 text-sm text-muted">
        {teacher.language}
        {teacher.nationality ? ` · ${teacher.nationality}` : ""}
        {teacher.age ? ` · ${teacher.age}` : ""}
      </p>

      <div className="mt-6">
        <TeacherEditForm teacher={teacher} />
      </div>

      <div className="mt-10">
        <h2 className="text-lg font-semibold text-text mb-3">Image library</h2>
        <TeacherImagePanel teacherId={teacher.id} initialImages={images} />
      </div>
    </div>
  );
}
