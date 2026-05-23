import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth";
import {
  sniffImageMimeFromArrayBuffer,
  MAX_IMAGE_BYTES,
} from "@/lib/upload-validation";
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

export async function GET(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const teacherId = request.nextUrl.searchParams.get("teacher_id");
  const contextFilter = request.nextUrl.searchParams.get("context");
  const tagFilter = request.nextUrl.searchParams.get("tag");

  const sb = getAdminClient();
  let query = sb
    .from("teacher_images")
    .select("*")
    .order("created_at", { ascending: false });

  if (teacherId) query = query.eq("teacher_id", teacherId);
  if (contextFilter) query = query.eq("context", contextFilter);
  if (tagFilter) query = query.contains("tags", [tagFilter]);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ images: data });
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const form = await request.formData().catch(() => null);
  if (!form) {
    return NextResponse.json(
      { error: "expected multipart/form-data" },
      { status: 400 },
    );
  }

  const teacherId = form.get("teacher_id");
  if (typeof teacherId !== "string" || !teacherId) {
    return NextResponse.json(
      { error: "teacher_id required" },
      { status: 400 },
    );
  }

  const contextRaw = form.get("context");
  const context: ImageContext | null =
    typeof contextRaw === "string" &&
    (VALID_CONTEXTS as string[]).includes(contextRaw)
      ? (contextRaw as ImageContext)
      : null;

  const tagsRaw = form.get("tags");
  const tags =
    typeof tagsRaw === "string"
      ? tagsRaw
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "no files" }, { status: 400 });
  }

  const sb = getAdminClient();
  const created = [];

  for (const file of files) {
    // Hard size cap — bail before reading anything large into memory.
    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { error: `file "${file.name}" exceeds ${MAX_IMAGE_BYTES} bytes` },
        { status: 413 },
      );
    }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `teachers/${teacherId}/${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}-${safeName}`;
    const arrayBuf = await file.arrayBuffer();

    // Magic-byte sniff — refuses anything that isn't a real PNG/JPEG/
    // WebP/GIF. Blocks SVG (XSS vector) and HTML/PDF disguised as image.
    const sniffedMime = sniffImageMimeFromArrayBuffer(arrayBuf);
    if (!sniffedMime) {
      return NextResponse.json(
        {
          error: `file "${file.name}" is not a supported image (PNG/JPEG/WebP/GIF required)`,
        },
        { status: 415 },
      );
    }

    const { error: upErr } = await sb.storage
      .from(BUCKET)
      .upload(path, arrayBuf, {
        // Use the sniffed type, never the client-declared one. This
        // ensures the bucket serves the file with the correct
        // Content-Type and ignores any "image/png" lie from the client.
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
    const storageUrl = pub.publicUrl;

    const { data: row, error: insErr } = await sb
      .from("teacher_images")
      .insert({
        teacher_id: teacherId,
        storage_url: storageUrl,
        tags,
        context,
      })
      .select("*")
      .single();
    if (insErr) {
      return NextResponse.json(
        { error: `insert failed: ${insErr.message}` },
        { status: 500 },
      );
    }
    created.push(row);
  }

  return NextResponse.json({ images: created }, { status: 201 });
}
