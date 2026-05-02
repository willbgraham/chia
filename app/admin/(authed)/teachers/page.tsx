import Link from "next/link";
import { Plus } from "lucide-react";
import { getAdminClient } from "@/lib/supabase/admin";
import { TeacherCard } from "@/components/admin/TeacherCard";
import { Button } from "@/components/ui/Button";
import type { Teacher } from "@/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function TeachersPage() {
  const sb = getAdminClient();
  const { data, error } = await sb
    .from("teachers")
    .select("*")
    .order("created_at", { ascending: true });

  const teachers = (data ?? []) as Teacher[];

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text">Teachers</h1>
          <p className="mt-1 text-sm text-muted">
            Manage every ChiaChat teacher persona, voice, and prompts.
          </p>
        </div>
        <Link href="/admin/teachers/new">
          <Button>
            <Plus className="h-4 w-4" />
            New teacher
          </Button>
        </Link>
      </div>

      {error ? (
        <p className="mt-6 text-sm text-danger">{error.message}</p>
      ) : teachers.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted">
          No teachers yet. Run <code className="text-text">supabase/seed.sql</code> to
          insert Chia, or create one manually.
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {teachers.map((t) => (
            <TeacherCard key={t.id} teacher={t} />
          ))}
        </div>
      )}
    </div>
  );
}
