// Student-initiated "Clear what Chia remembers" — soft-wipe of the
// memory_json fields that represent Chia's IMPRESSIONS of the student
// (interests, weak points, recent chat buffer, inside references).
//
// KEEPS structural settings (name, level, native_language,
// lesson_mode, reminder_preference, curriculum_position, plan) so the
// student doesn't have to re-onboard.
//
// Also clears the rolling buffer in users.memory_json._recent AND
// optionally deletes embeddings on past messages so semantic
// retrieval starts fresh too. Messages themselves are RETAINED for
// audit / GDPR — to delete those entirely, students email support.

import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { verifyAccountToken } from "@/lib/account/magic-link";

export const runtime = "nodejs";

// Keys we preserve from memory_json after a memory clear. Everything
// else (personal, language_progress, milestones, inside_references,
// _recent, last_session, streak_days) is dropped.
const STRUCTURAL_KEYS = [
  "name",
  "native_language",
  "level",
  "lesson_mode",
  "reminder_preference",
  "reminder_time",
  "plan",
  "curriculum_position",
] as const;

export async function POST(
  _request: NextRequest,
  { params }: { params: { token: string } },
) {
  const verified = verifyAccountToken(params.token);
  if (!verified) {
    return NextResponse.json(
      { error: "expired or invalid link" },
      { status: 401 },
    );
  }

  const sb = getAdminClient();

  // Read current memory_json so we can preserve the structural keys.
  const { data: user, error: readErr } = await sb
    .from("users")
    .select("memory_json")
    .eq("id", verified.userId)
    .single();
  if (readErr || !user) {
    return NextResponse.json(
      { error: readErr?.message ?? "user not found" },
      { status: 404 },
    );
  }

  const current = (user.memory_json ?? {}) as Record<string, unknown>;
  const preserved: Record<string, unknown> = {};
  for (const key of STRUCTURAL_KEYS) {
    if (current[key] !== undefined) {
      preserved[key] = current[key];
    }
  }

  // Replace memory_json with just the structural keys.
  const { error: updErr } = await sb
    .from("users")
    .update({ memory_json: preserved })
    .eq("id", verified.userId);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  // Also clear embeddings on past messages so pgvector retrieval
  // doesn't pull old context back in. Messages stay (for audit), but
  // become invisible to semantic search. Best-effort — errors logged
  // but not fatal.
  const { error: embErr } = await sb
    .from("messages")
    .update({ embedding: null })
    .eq("user_id", verified.userId);
  if (embErr) {
    console.error("[memory delete] embedding clear failed:", embErr.message);
  }

  return new NextResponse(null, { status: 204 });
}
