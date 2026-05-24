// Admin-only acquisition-funnel endpoint. Exposes the same data the
// dashboard renders, in JSON, so a future Slack-summary cron / cell-
// link spreadsheet / mobile dashboard can hit a single source of truth.
//
// GET /api/admin/funnel
//   returns: FunnelStats (see lib/handlers/funnel-stats.ts)

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { fetchFunnelStats } from "@/lib/handlers/funnel-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const stats = await fetchFunnelStats();
    return NextResponse.json(stats);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
