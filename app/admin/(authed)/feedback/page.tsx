// Admin-side feedback list. Server fetches the rows (newest first,
// filtered by status); client component renders + handles inline
// resolve / unresolve / delete / edit-admin-notes actions.

import { getAdminClient } from "@/lib/supabase/admin";
import type { Feedback } from "@/types";
import { FeedbackList, type FeedbackWithUser } from "./FeedbackList";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PAGE_SIZE = 50;

type StatusFilter = "open" | "resolved" | "all";

export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: { status?: string; page?: string };
}) {
  const statusRaw = searchParams.status ?? "open";
  const status: StatusFilter =
    statusRaw === "resolved" || statusRaw === "all" ? statusRaw : "open";
  const page = Math.max(1, Number.parseInt(searchParams.page ?? "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const sb = getAdminClient();
  let query = sb
    .from("feedback")
    .select("*, users!inner(whatsapp_number, memory_json, plan)", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range(from, to);
  if (status === "open") query = query.eq("resolved", false);
  else if (status === "resolved") query = query.eq("resolved", true);

  const { data, error, count } = await query;

  const items: FeedbackWithUser[] = ((data ?? []) as unknown as Array<
    Feedback & {
      users: {
        whatsapp_number: string;
        memory_json: { name?: string } | null;
        plan: string;
      };
    }
  >).map((row) => ({
    id: row.id,
    user_id: row.user_id,
    rating: row.rating,
    body: row.body,
    resolved: row.resolved,
    admin_notes: row.admin_notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
    user_whatsapp_number: row.users.whatsapp_number,
    user_name: row.users.memory_json?.name ?? null,
    user_plan: row.users.plan,
  }));

  const total = count ?? items.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Quick counts for the tab UI — two extra lightweight count queries.
  // Cheap because feedback table will stay small.
  const [{ count: openCount }, { count: resolvedCount }] = await Promise.all([
    sb
      .from("feedback")
      .select("id", { count: "exact", head: true })
      .eq("resolved", false),
    sb
      .from("feedback")
      .select("id", { count: "exact", head: true })
      .eq("resolved", true),
  ]);

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text">Feedback</h1>
          <p className="mt-1 text-sm text-muted">
            {total} shown · what students are telling us. Mark as resolved
            once handled, add private admin notes for follow-up.
          </p>
        </div>
      </div>

      {/* Status tabs */}
      <div className="mt-6 inline-flex gap-1 rounded-lg border border-border bg-surface p-1 text-xs">
        <Tab
          href={`/admin/feedback?status=open`}
          label={`Open (${openCount ?? 0})`}
          active={status === "open"}
        />
        <Tab
          href={`/admin/feedback?status=resolved`}
          label={`Resolved (${resolvedCount ?? 0})`}
          active={status === "resolved"}
        />
        <Tab
          href={`/admin/feedback?status=all`}
          label={`All (${(openCount ?? 0) + (resolvedCount ?? 0)})`}
          active={status === "all"}
        />
      </div>

      {error ? (
        <p className="mt-6 text-sm text-danger">{error.message}</p>
      ) : items.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border bg-surface p-10 text-center">
          <p className="text-sm text-muted">
            No {status === "all" ? "" : status} feedback yet.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          <FeedbackList items={items} />
          {totalPages > 1 ? (
            <div className="flex items-center justify-between text-sm pt-2">
              <span className="text-muted">
                Page {page} of {totalPages}
              </span>
              <div className="flex items-center gap-2">
                {page > 1 ? (
                  <a
                    href={`/admin/feedback?status=${status}&page=${page - 1}`}
                    className="rounded-md border border-border px-3 py-1.5 text-text hover:bg-surface"
                  >
                    ← Prev
                  </a>
                ) : null}
                {page < totalPages ? (
                  <a
                    href={`/admin/feedback?status=${status}&page=${page + 1}`}
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

function Tab({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <a
      href={href}
      className={
        "rounded-md px-3 py-1.5 transition-colors " +
        (active
          ? "bg-bg text-text font-semibold"
          : "text-muted hover:text-text")
      }
    >
      {label}
    </a>
  );
}
