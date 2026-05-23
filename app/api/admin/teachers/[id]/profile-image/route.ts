// Upload a teacher's profile photo. Stores into the chiachat-media bucket
// under teachers/<id>/profile/... and writes the public URL onto
// teachers.profile_image_url. The bucket is public so the URL renders
// directly without signed-URL gymnastics.

import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth";
import {
  sniffImageMimeFromArrayBuffer,
  MAX_IMAGE_BYTES,
} from "@/lib/upload-validation";

export const runtime = "nodejs";

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "chiachat-media";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const form = await request.formData().catch(() => null);
  if (!form) {
    return NextResponse.json(
      { error: "expected multipart/form-data" },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: `file exceeds ${MAX_IMAGE_BYTES} bytes` },
      { status: 413 },
    );
  }

  const sb = getAdminClient();

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `teachers/${params.id}/profile/${Date.now()}-${safeName}`;
  const arrayBuf = await file.arrayBuffer();

  // Magic-byte sniff. Refuses anything that isn't a real PNG/JPEG/WebP/
  // GIF — blocks SVG (XSS vector) and HTML/PDF disguised as image.
  const sniffedMime = sniffImageMimeFromArrayBuffer(arrayBuf);
  if (!sniffedMime) {
    return NextResponse.json(
      {
        error: "file is not a supported image (PNG/JPEG/WebP/GIF required)",
      },
      { status: 415 },
    );
  }

  const { error: upErr } = await sb.storage.from(BUCKET).upload(path, arrayBuf, {
    // Use the sniffed type, never the client-declared one.
    contentType: sniffedMime,
    upsert: false,
  });
  if (upErr) {
    return NextResponse.json(
      { error: `upload failed: ${upErr.message}` },
      { status: 500 },
    );
  }

  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
  const publicUrl = pub.publicUrl;

  const { data: row, error: updErr } = await sb
    .from("teachers")
    .update({ profile_image_url: publicUrl })
    .eq("id", params.id)
    .select("*")
    .single();
  if (updErr) {
    return NextResponse.json(
      { error: `update failed: ${updErr.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ teacher: row, profile_image_url: publicUrl });
}

// Clear the teacher's profile image (sets the column to null). The
// underlying storage object is not deleted — that's manual cleanup
// via the Supabase dashboard if it ever matters.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const sb = getAdminClient();
  const { data, error } = await sb
    .from("teachers")
    .update({ profile_image_url: null })
    .eq("id", params.id)
    .select("*")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ teacher: data });
}
