import Link from "next/link";
import { Plus } from "lucide-react";
import { getAdminClient } from "@/lib/supabase/admin";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import type { Lesson } from "@/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function LessonsPage() {
  const sb = getAdminClient();
  const { data, error } = await sb
    .from("lessons")
    .select("*")
    .order("language", { ascending: true })
    .order("level", { ascending: true })
    .order("lesson_number", { ascending: true });

  const lessons = (data ?? []) as Lesson[];

  // Group by language → level for the list view.
  const grouped = new Map<string, Map<string, Lesson[]>>();
  for (const l of lessons) {
    if (!grouped.has(l.language)) grouped.set(l.language, new Map());
    const levels = grouped.get(l.language)!;
    if (!levels.has(l.level)) levels.set(l.level, []);
    levels.get(l.level)!.push(l);
  }

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text">Lessons</h1>
          <p className="mt-1 text-sm text-muted">
            Curriculum content. Chia reads these in structured-lesson mode.
          </p>
        </div>
        <Link href="/admin/lessons/new">
          <Button>
            <Plus className="h-4 w-4" />
            New lesson
          </Button>
        </Link>
      </div>

      {error ? (
        <p className="mt-6 text-sm text-danger">{error.message}</p>
      ) : lessons.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted">
          No lessons yet. Run <code className="text-text">supabase/seed.sql</code> to
          insert the 5 starter Spanish lessons, or create one manually.
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {Array.from(grouped.entries()).map(([lang, levels]) => (
            <div key={lang}>
              <h2 className="text-base font-semibold text-text">{lang}</h2>
              <div className="mt-2 space-y-4">
                {Array.from(levels.entries()).map(([level, items]) => (
                  <div key={level}>
                    <div className="text-xs uppercase tracking-wide text-muted mb-1.5">
                      {level}
                    </div>
                    <div className="rounded-lg border border-border bg-surface divide-y divide-border">
                      {items.map((l) => (
                        <Link
                          key={l.id}
                          href={`/admin/lessons/${l.id}`}
                          className="block px-4 py-3 hover:bg-bg"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-medium text-text">
                                <span className="text-muted mr-2">
                                  #{l.lesson_number}
                                </span>
                                {l.title}
                              </div>
                              <div className="text-xs text-muted mt-0.5">
                                {l.topic}
                              </div>
                            </div>
                            <Badge tone="neutral">
                              {l.content?.items?.length ?? 0} items
                            </Badge>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
