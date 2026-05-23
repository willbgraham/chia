// Student-side feedback submission endpoint. Magic-link auth via the
// path token, same as every other /api/account/[token]/* endpoint.
//
// POST /api/account/[token]/feedback
//   body: { rating?: 1..5, body: string }  (rating optional, body required)
//   returns: { ok: true, id: uuid }
//
// GET  /api/account/[token]/feedback
//   returns: { items: Feedback[] }  — this student's own past feedback
//                                     (newest first, last 20) so the
//                                     page can show "you've sent: ..."

import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { verifyAccountToken } from "@/lib/account/magic-link";
import type { Feedback } from "@/types";

export const runtime = "nodejs";

interface PostBody {
  rating?: number;
  body?: string;
}

const MAX_BODY_CHARS = 4000;
const PER_USER_HOURLY_CAP = 10; // soft rate limit — abuse guard

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

  const raw = (await request.json().catch(() => null)) as PostBody | null;
  if (!raw) {
    return NextResponse.json(
      { error: "expected JSON body { rating?, body }" },
      { status: 400 },
    );
  }

  const body = typeof raw.body === "string" ? raw.body.trim() : "";
  if (body.length === 0) {
    return NextResponse.json(
      { error: "body is required" },
      { status: 400 },
    );
  }
  if (body.length > MAX_BODY_CHARS) {
    return NextResponse.json(
      { error: `body must be ≤${MAX_BODY_CHARS} chars` },
      { status: 413 },
    );
  }

  let rating: number | null = null;
  if (raw.rating !== undefined && raw.rating !== null) {
    const r = Number(raw.rating);
    if (!Number.isInteger(r) || r < 1 || r > 5) {
      return NextResponse.json(
        { error: "rating must be an integer 1-5" },
        { status: 400 },
      );
    }
    rating = r;
  }

  const sb = getAdminClient();

  // Rate limit: count this user's submissions in the last hour. We
  // don't have proper rate-limit infrastructure but a quick COUNT
  // catches obvious abuse (rapid scripted POSTs against a leaked
  // token).
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recentCount } = await sb
    .from("feedback")
    .select("id", { count: "exact", head: true })
    .eq("user_id", verified.userId)
    .gte("created_at", oneHourAgo);
  if ((recentCount ?? 0) >= PER_USER_HOURLY_CAP) {
    return NextResponse.json(
      { error: "too many submissions — try again later" },
      { status: 429 },
    );
  }

  const { data, error } = await sb
    .from("feedback")
    .insert({
      user_id: verified.userId,
      rating,
      body,
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data.id });
}

export async function GET(
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
  // Strip admin_notes from the response — those are private to the
  // operator and should never be visible to the student even though
  // their auth token would technically grant access.
  const { data, error } = await sb
    .from("feedback")
    .select("id, user_id, rating, body, resolved, created_at, updated_at")
    .eq("user_id", verified.userId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    items: (data ?? []) as Omit<Feedback, "admin_notes">[],
  });
}
