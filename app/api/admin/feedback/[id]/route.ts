// Admin mutation on a single feedback row. Two operations:
//   PATCH /api/admin/feedback/[id]
//     body: { resolved?: boolean, admin_notes?: string | null }
//     returns: { ok: true, feedback: Feedback }
//
//   DELETE /api/admin/feedback/[id]
//     hard delete (used to clean spam/test rows)
//     returns: { ok: true }

import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth";
import type { Feedback } from "@/types";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NOTES_CHARS = 4000;

interface PatchBody {
  resolved?: boolean;
  admin_notes?: string | null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  const raw = (await request.json().catch(() => null)) as PatchBody | null;
  if (!raw || (raw.resolved === undefined && raw.admin_notes === undefined)) {
    return NextResponse.json(
      { error: "expected { resolved?, admin_notes? }" },
      { status: 400 },
    );
  }

  const patch: Record<string, unknown> = {};
  if (raw.resolved !== undefined) {
    if (typeof raw.resolved !== "boolean") {
      return NextResponse.json(
        { error: "resolved must be boolean" },
        { status: 400 },
      );
    }
    patch.resolved = raw.resolved;
  }
  if (raw.admin_notes !== undefined) {
    if (raw.admin_notes === null) {
      patch.admin_notes = null;
    } else if (typeof raw.admin_notes !== "string") {
      return NextResponse.json(
        { error: "admin_notes must be string or null" },
        { status: 400 },
      );
    } else {
      const trimmed = raw.admin_notes.slice(0, MAX_NOTES_CHARS);
      patch.admin_notes = trimmed.length === 0 ? null : trimmed;
    }
  }

  const sb = getAdminClient();
  const { data, error } = await sb
    .from("feedback")
    .update(patch)
    .eq("id", params.id)
    .select("*")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, feedback: data as Feedback });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  const sb = getAdminClient();
  const { error } = await sb.from("feedback").delete().eq("id", params.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
