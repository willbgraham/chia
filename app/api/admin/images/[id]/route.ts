import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth";
import type { ImageContext } from "@/types";

export const runtime = "nodejs";

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "chiachat-media";

const VALID_CONTEXTS: ImageContext[] = [
  "morning",
  "evening",
  "happy",
  "thoughtful",
  "location",
  "lesson",
  "celebration",
  "correction",
  "greeting",
  "general",
];

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

  const update: { tags?: string[]; context?: ImageContext | null } = {};
  if (Array.isArray(body.tags)) {
    update.tags = body.tags
      .filter((t: unknown): t is string => typeof t === "string")
      .map((t: string) => t.trim())
      .filter(Boolean);
  }
  if ("context" in body) {
    if (body.context === null) update.context = null;
    else if (
      typeof body.context === "string" &&
      (VALID_CONTEXTS as string[]).includes(body.context)
    ) {
      update.context = body.context as ImageContext;
    } else {
      return NextResponse.json({ error: "invalid context" }, { status: 400 });
    }
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "no valid fields" }, { status: 400 });
  }

  const sb = getAdminClient();
  const { data, error } = await sb
    .from("teacher_images")
    .update(update)
    .eq("id", params.id)
    .select("*")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ image: data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const sb = getAdminClient();
  const { data: existing, error: fetchErr } = await sb
    .from("teacher_images")
    .select("storage_url")
    .eq("id", params.id)
    .single();
  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 404 });
  }

  // Best-effort: remove the underlying object too. We derive the
  // storage path from the public URL.
  if (existing?.storage_url) {
    const marker = `/${BUCKET}/`;
    const idx = existing.storage_url.indexOf(marker);
    if (idx >= 0) {
      const path = existing.storage_url.slice(idx + marker.length);
      await sb.storage.from(BUCKET).remove([path]);
    }
  }

  const { error } = await sb
    .from("teacher_images")
    .delete()
    .eq("id", params.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
