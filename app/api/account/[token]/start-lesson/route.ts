// Set the student's curriculum_position to a specific lesson and
// reset state to active_free_chat so the next inbound WhatsApp
// message lands cleanly. Used by the Learn / Relearn buttons on
// the curriculum dashboard.
//
// POST body: { lesson_id: uuid }
//
// Returns the WhatsApp deep-link URL the client should redirect to;
// the message body is a phrase that maps to wantsResumeLesson() in
// free-chat, which fires handleLesson() at the curriculum_position
// we just set.

import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { verifyAccountToken } from "@/lib/account/magic-link";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const WHATSAPP_NUMBER =
  process.env.NEXT_PUBLIC_CHIA_WHATSAPP_NUMBER ?? "34600974942";

interface Body {
  lesson_id?: string;
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
  if (!body || typeof body.lesson_id !== "string" || !UUID_RE.test(body.lesson_id)) {
    return NextResponse.json(
      { error: "expected {lesson_id: uuid}" },
      { status: 400 },
    );
  }

  const sb = getAdminClient();

  // Look up the lesson — we need topic + lesson_number to update
  // curriculum_position, and the lesson row's existence is the
  // implicit validation that lesson_id is real.
  const { data: lesson } = await sb
    .from("lessons")
    .select("id, topic, lesson_number, title")
    .eq("id", body.lesson_id)
    .maybeSingle();
  if (!lesson) {
    return NextResponse.json({ error: "lesson not found" }, { status: 404 });
  }

  // Read existing memory_json so we don't clobber unrelated fields.
  const { data: user } = await sb
    .from("users")
    .select("memory_json")
    .eq("id", verified.userId)
    .single();
  const memory =
    (user?.memory_json as {
      curriculum_position?: {
        current_topic?: string;
        current_lesson?: number;
        completed_topics?: string[];
      };
      [key: string]: unknown;
    } | null) ?? {};
  const pos = memory.curriculum_position ?? {};

  // Patch curriculum_position to the chosen lesson. Keep
  // completed_topics intact.
  const { error: updErr } = await sb
    .from("users")
    .update({
      memory_json: {
        ...memory,
        curriculum_position: {
          current_topic: lesson.topic,
          current_lesson: lesson.lesson_number,
          completed_topics: pos.completed_topics ?? [],
        },
      },
    })
    .eq("id", verified.userId);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  // Reset conversation state to active_free_chat so the next
  // inbound message routes through handleFreeChat's intent
  // detectors. The student's WhatsApp deep-link text triggers
  // wantsResumeLesson, which fires handleLesson at the new
  // curriculum_position.
  await sb
    .from("conversation_state")
    .update({
      state: "active_free_chat",
      pending_phrase: null,
      pending_audio_url: null,
      last_message_at: new Date().toISOString(),
    })
    .eq("user_id", verified.userId);

  // Prefilled WhatsApp text matches a trigger in wantsResumeLesson()
  // (lib/handlers/free-chat.ts) so the lesson fires immediately.
  // Using "Let's pick up the lesson" — natural-sounding + unambiguous.
  const message = `Let's pick up the lesson 🌿`;
  const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;

  return NextResponse.json({ url });
}
