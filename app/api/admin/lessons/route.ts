import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const language = request.nextUrl.searchParams.get("language");
  const level = request.nextUrl.searchParams.get("level");

  const sb = getAdminClient();
  let query = sb
    .from("lessons")
    .select("*")
    .order("language", { ascending: true })
    .order("level", { ascending: true })
    .order("lesson_number", { ascending: true });

  if (language) query = query.eq("language", language);
  if (level) query = query.eq("level", level);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ lessons: data });
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const required = ["language", "level", "topic", "lesson_number", "title", "content"];
  for (const field of required) {
    if (!(field in body)) {
      return NextResponse.json(
        { error: `missing ${field}` },
        { status: 400 },
      );
    }
  }

  const sb = getAdminClient();
  const { data, error } = await sb
    .from("lessons")
    .insert({
      language: body.language,
      level: body.level,
      topic: body.topic,
      lesson_number: body.lesson_number,
      title: body.title,
      content: body.content,
    })
    .select("*")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ lesson: data }, { status: 201 });
}
