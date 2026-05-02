import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";

const EDITABLE_FIELDS = [
  "name",
  "language",
  "gender",
  "nationality",
  "age",
  "whatsapp_number",
  "elevenlabs_voice_id",
  "elevenlabs_agent_id",
  "system_prompt",
  "agent_voice_prompt",
  "backstory",
  "profile_image_url",
  "is_active",
] as const;

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const sb = getAdminClient();
  const { data, error } = await sb
    .from("teachers")
    .select("*")
    .eq("id", params.id)
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  return NextResponse.json({ teacher: data });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    if (field in body) update[field] = body[field];
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "no valid fields" }, { status: 400 });
  }

  const sb = getAdminClient();
  const { data, error } = await sb
    .from("teachers")
    .update(update)
    .eq("id", params.id)
    .select("*")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ teacher: data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const sb = getAdminClient();
  const { error } = await sb.from("teachers").delete().eq("id", params.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
