// Admin-side feedback list endpoint. Read-only here; mutations
// (resolve / add admin_notes) go to /api/admin/feedback/[id].
//
// GET /api/admin/feedback?status=open|resolved|all&page=1
//   returns: { items: FeedbackWithUser[], total, page, pageSize }

import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth";
import type { Feedback } from "@/types";

export const runtime = "nodejs";

const PAGE_SIZE = 50;

type StatusFilter = "open" | "resolved" | "all";

export interface FeedbackWithUser extends Feedback {
  user_whatsapp_number: string;
  user_name: string | null;
  user_plan: string;
}

export async function GET(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const sp = request.nextUrl.searchParams;
  const statusRaw = sp.get("status") ?? "open";
  const status: StatusFilter =
    statusRaw === "resolved" || statusRaw === "all" ? statusRaw : "open";
  const page = Math.max(1, Number.parseInt(sp.get("page") ?? "1", 10) || 1);
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
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Flatten the joined user row into a few denormalized fields so
  // the admin page can render without further joins. Drop the raw
  // memory_json blob — only name is useful here.
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

  return NextResponse.json({
    items,
    total: count ?? items.length,
    page,
    pageSize: PAGE_SIZE,
  });
}
