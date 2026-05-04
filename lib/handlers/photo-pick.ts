// Mid-conversation photo delivery for premium students.
//
// The flow on each free-chat reply (premium only):
//   1. Classify the reply — would a photo enhance this turn? if yes,
//      what context fits ("morning" / "celebration" / "thoughtful" / etc.)?
//   2. Pick an image from teacher_images filtered by teacher + context.
//      Skip any image already sent to this student in the last 30 days
//      so it doesn't feel repetitive.
//   3. Log the send to teacher_image_sends so the next pick avoids
//      repeating.
//
// Frequency control: we ALSO skip if we already sent any image to
// this student in the last ~6 turns. Photos are precious — sending
// one every reply makes them feel cheap. Roughly one per session.

import { getAdminClient } from "@/lib/supabase/admin";
import { chatCompletion } from "@/lib/messaging/openai";
import type { ImageContext } from "@/types";

// The image_worthy moments we ask GPT to identify.
const VALID_CONTEXTS: ImageContext[] = [
  "morning",
  "evening",
  "happy",
  "thoughtful",
  "location",
  "lesson",
  "celebration",
  "correction",
  "general",
  // "greeting" intentionally excluded — that's onboarding-only
];

// How recently must NOT have been sent to qualify. 30 days = a student
// won't see the same Chia photo twice unless she has very few uploaded.
const REPEAT_BLOCK_DAYS = 30;

// How many recent turns without a photo before we'll send another.
// Tuned by feel — if the student got a photo in the last ~6 of their
// turns, skip. Roughly 1 photo per ~6 turns max.
const MIN_TURNS_BETWEEN_PHOTOS = 6;

export interface PhotoPickResult {
  imageId: string;
  storageUrl: string;
  context: ImageContext | null;
}

// Top-level: given a Chia reply, decide whether to send a photo and
// pick one if so. Returns null if nothing should be sent.
//
// Premium gating + frequency check happens BEFORE this is called by
// the caller (free-chat handler). This function focuses purely on:
// "given that we're allowed to send, classify + pick".
export async function pickContextualPhoto(args: {
  userId: string;
  teacherId: string;
  chiaReply: string;
  studentMessage: string;
}): Promise<PhotoPickResult | null> {
  // 1. Frequency check — skip if we already sent a photo recently.
  const recentlySent = await sentPhotoRecently(args.userId);
  if (recentlySent) return null;

  // 2. Classify the moment. Returns null if no context matches.
  const context = await classifyContext(args.chiaReply, args.studentMessage);
  if (!context) return null;

  // 3. Pick an image. Returns null if no eligible image.
  return pickImage({
    userId: args.userId,
    teacherId: args.teacherId,
    context,
  });
}

async function sentPhotoRecently(userId: string): Promise<boolean> {
  const sb = getAdminClient();
  // Look at the last MIN_TURNS_BETWEEN_PHOTOS messages. If any sent
  // image is dated after that timestamp, skip.
  // We approximate "last N turns" with "last 5 minutes" — fine for
  // typical chat cadence; adjust if needed.
  const cutoff = new Date(
    Date.now() - 5 * 60 * 1000,
  ).toISOString();
  const { count } = await sb
    .from("teacher_image_sends")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("sent_at", cutoff);
  return (count ?? 0) >= 1;
}

async function classifyContext(
  chiaReply: string,
  studentMessage: string,
): Promise<ImageContext | null> {
  // Single GPT-4o-mini call — cheap, deterministic-ish at temperature 0.
  // We ask it to either return one of the valid contexts or "none".
  const system = `You analyze a Spanish-teacher chat and decide whether sending a photo of the teacher would meaningfully enhance the moment for the student.

Available contexts (return exactly one, or "none"):
- morning      — student is talking about morning, breakfast, waking up
- evening      — student is talking about night, dinner, going out
- happy        — celebratory or joyful moment, student is laughing or excited
- thoughtful   — teacher is explaining something tricky, philosophical, or meaningful
- location     — talking about Valencia, Spain, beach, paella, travel
- lesson       — formally starting or wrapping up a learning topic
- celebration  — student hit a milestone (streak, level, breakthrough)
- correction   — teacher is gently correcting student
- general      — warm, ambient moment that fits anywhere

Return "none" if nothing fits. Better to skip than send a mismatched photo.

Respond with JSON: {"context": "<one-word>"}`;

  const user = `Student said: ${JSON.stringify(studentMessage.slice(0, 500))}
Chia replied: ${JSON.stringify(chiaReply.slice(0, 800))}

Pick the best context, or "none".`;

  let raw: string;
  try {
    raw = await chatCompletion(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      {
        temperature: 0,
        max_tokens: 30,
        response_format: { type: "json_object" },
      },
    );
  } catch (err) {
    console.error("[photo-pick] classify failed:", err);
    return null;
  }

  let parsed: { context?: string };
  try {
    parsed = JSON.parse(raw) as { context?: string };
  } catch {
    return null;
  }

  const ctx = parsed.context?.toLowerCase().trim();
  if (!ctx || ctx === "none") return null;
  if (!(VALID_CONTEXTS as string[]).includes(ctx)) return null;
  return ctx as ImageContext;
}

async function pickImage(args: {
  userId: string;
  teacherId: string;
  context: ImageContext;
}): Promise<PhotoPickResult | null> {
  const sb = getAdminClient();

  // 1. Find images for this teacher + context that haven't been sent
  // to this user in the last REPEAT_BLOCK_DAYS days.
  const repeatCutoff = new Date(
    Date.now() - REPEAT_BLOCK_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: recentSends } = await sb
    .from("teacher_image_sends")
    .select("image_id")
    .eq("user_id", args.userId)
    .gte("sent_at", repeatCutoff);
  const recentImageIds = (recentSends ?? []).map((r) => r.image_id);

  // 2. Eligible images: teacher + context + not in recent sends.
  let query = sb
    .from("teacher_images")
    .select("id, storage_url, context")
    .eq("teacher_id", args.teacherId)
    .eq("context", args.context);

  if (recentImageIds.length > 0) {
    query = query.not("id", "in", `(${recentImageIds.join(",")})`);
  }

  const { data: eligible, error } = await query;
  if (error || !eligible || eligible.length === 0) {
    // Fallback: try context='general' if specific context had nothing.
    if (args.context !== "general") {
      return pickImage({ ...args, context: "general" });
    }
    return null;
  }

  // 3. Pick randomly from eligible. Could refine to "least-recently
  // sent across all users" later for fairness across the photo library.
  const chosen = eligible[Math.floor(Math.random() * eligible.length)];

  // 4. Log the send.
  const { error: logErr } = await sb.from("teacher_image_sends").insert({
    teacher_id: args.teacherId,
    image_id: chosen.id,
    user_id: args.userId,
  });
  if (logErr) {
    console.error("[photo-pick] log failed:", logErr.message);
    // Continue anyway — the image will still go out, just not deduped.
  }

  return {
    imageId: chosen.id as string,
    storageUrl: chosen.storage_url as string,
    context: chosen.context as ImageContext | null,
  };
}
