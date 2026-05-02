import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";

const PAGE_SIZE = 50;

export async function GET(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const pageRaw = request.nextUrl.searchParams.get("page") ?? "1";
  const page = Math.max(1, Number.parseInt(pageRaw, 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const sb = getAdminClient();
  const { data, error, count } = await sb
    .from("users")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({
    users: data,
    page,
    page_size: PAGE_SIZE,
    total: count ?? 0,
  });
}
