import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const sb = getAdminClient();
  const { data, error } = await sb
    .from("teachers")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ teachers: data });
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const sb = getAdminClient();
  const { data, error } = await sb
    .from("teachers")
    .insert({
      name: body.name,
      language: body.language,
      gender: body.gender ?? null,
      nationality: body.nationality ?? null,
      age: body.age ?? null,
      whatsapp_number: body.whatsapp_number ?? null,
      elevenlabs_voice_id: body.elevenlabs_voice_id ?? null,
      elevenlabs_agent_id: body.elevenlabs_agent_id ?? null,
      system_prompt: body.system_prompt ?? null,
      agent_voice_prompt: body.agent_voice_prompt ?? null,
      backstory: body.backstory ?? null,
      profile_image_url: body.profile_image_url ?? null,
      is_active: body.is_active ?? true,
    })
    .select("*")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ teacher: data }, { status: 201 });
}
