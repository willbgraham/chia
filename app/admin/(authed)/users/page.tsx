import { getAdminClient } from "@/lib/supabase/admin";
import { UserTable } from "@/components/admin/UserTable";
import type { User } from "@/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PAGE_SIZE = 50;

export default async function UsersPage({
  searchParams,
}: {
  searchParams: { page?: string };
}) {
  const page = Math.max(1, Number.parseInt(searchParams.page ?? "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const sb = getAdminClient();
  const { data, error, count } = await sb
    .from("users")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  const users = (data ?? []) as User[];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text">Users</h1>
          <p className="mt-1 text-sm text-muted">
            {total} total · numbers masked for privacy · click a row to expand
            memory.
          </p>
        </div>
      </div>

      {error ? (
        <p className="mt-6 text-sm text-danger">{error.message}</p>
      ) : (
        <div className="mt-6 space-y-4">
          <UserTable users={users} />
          {totalPages > 1 ? (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted">
                Page {page} of {totalPages}
              </span>
              <div className="flex items-center gap-2">
                {page > 1 ? (
                  <a
                    href={`/admin/users?page=${page - 1}`}
                    className="rounded-md border border-border px-3 py-1.5 text-text hover:bg-surface"
                  >
                    ← Prev
                  </a>
                ) : null}
                {page < totalPages ? (
                  <a
                    href={`/admin/users?page=${page + 1}`}
                    className="rounded-md border border-border px-3 py-1.5 text-text hover:bg-surface"
                  >
                    Next →
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
