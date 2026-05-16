// Toggle a student's completion of one lesson. Reached from the
// curriculum dashboard at /account/[token]/curriculum.
//
// POST body: { lesson_id: uuid, completed: boolean }
//   completed = true  → upsert user_lesson_progress row, status=completed
//   completed = false → delete the row entirely (student wants to
//                       re-learn this; pointer in curriculum_position
//                       is intentionally untouched)
//
// Idempotent: re-checking a checked lesson is a no-op; re-unchecking
// an unchecked lesson is a no-op.

import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { verifyAccountToken } from "@/lib/account/magic-link";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Body {
  lesson_id?: string;
  completed?: boolean;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { token: string } },
) {
  const verified = verifyAccountToken(params.token);
  if (!verified) {
    return NextResponse.json(
      { error: "expired or invalid link" },
      { status: 401 },
    );
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  if (
    !body ||
    typeof body.lesson_id !== "string" ||
    !UUID_RE.test(body.lesson_id) ||
    typeof body.completed !== "boolean"
  ) {
    return NextResponse.json(
      { error: "expected {lesson_id: uuid, completed: bool}" },
      { status: 400 },
    );
  }

  const sb = getAdminClient();

  // Validate the lesson_id actually exists — otherwise a bad
  // client could pollute progress rows.
  const { data: lesson } = await sb
    .from("lessons")
    .select("id")
    .eq("id", body.lesson_id)
    .maybeSingle();
  if (!lesson) {
    return NextResponse.json({ error: "lesson not found" }, { status: 404 });
  }

  if (body.completed) {
    // Mark complete. Upsert keyed on (user_id, lesson_id) which has
    // a unique index (added in the earlier curriculum migration).
    const { error } = await sb.from("user_lesson_progress").upsert(
      {
        user_id: verified.userId,
        lesson_id: body.lesson_id,
        status: "completed",
        completed_at: new Date().toISOString(),
      },
      { onConflict: "user_id,lesson_id", ignoreDuplicates: false },
    );
    if (error) {
      console.error("[lesson-progress] upsert error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } else {
    // Mark for re-learn — delete the row entirely. Cleaner than
    // leaving a status='not_started' row; curriculum.ts queries
    // for completed-only anyway.
    const { error } = await sb
      .from("user_lesson_progress")
      .delete()
      .eq("user_id", verified.userId)
      .eq("lesson_id", body.lesson_id);
    if (error) {
      console.error("[lesson-progress] delete error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return new NextResponse(null, { status: 204 });
}
