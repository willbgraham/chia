// Structured-lesson handler: pull the lesson the student is up to from the
// curriculum, format it for WhatsApp, send it, and offer audio for the
// first audio-worthy item.

import { sendText } from "@/lib/messaging/whatsapp";
import { chatCompletion } from "@/lib/messaging/openai";
import { getAdminClient } from "@/lib/supabase/admin";
import { getMemory, patchMemory } from "@/lib/handlers/memory";
import { updateState } from "@/lib/handlers/state";
import type { Lesson, LessonContent, LessonItem } from "@/types";

interface LessonArgs {
  userId: string;
  whatsappNumber: string;
  teacherId: string | null;
  userMessage: string;
}

export async function handleLesson(args: LessonArgs): Promise<void> {
  const memory = await getMemory(args.userId);
  const pos = memory.curriculum_position;

  if (!pos?.current_topic || !pos.current_lesson) {
    // No curriculum position — fall back to free chat behaviour
    await sendText(
      args.whatsappNumber,
      "Hmm — I don't have a lesson queued for you. Want to just chat for now? 🌿",
    );
    await updateState(args.userId, { state: "active_free_chat" });
    return;
  }

  const lesson = await fetchLesson({
    language: "Spanish",
    level: memory.level ?? "beginner",
    topic: pos.current_topic,
    lessonNumber: pos.current_lesson,
  });

  if (!lesson) {
    // Out of curriculum — student finished the available lessons.
    await sendText(
      args.whatsappNumber,
      "You've reached the end of what I have prepared 🌿 Let's switch to free chat — ask me anything.",
    );
    await updateState(args.userId, { state: "active_free_chat" });
    return;
  }

  // Format the lesson into a WhatsApp-friendly message via GPT (uses Chia's
  // voice). Keep it short and punchy.
  const formatted = await formatLesson(lesson, args.teacherId);
  await sendText(args.whatsappNumber, formatted);

  // Find the first audio-worthy item and offer to speak it.
  const audioItem = lesson.content.items?.find((i) => i.audio_worthy);
  if (audioItem) {
    await sendText(
      args.whatsappNumber,
      `Want to hear me say "${audioItem.target_language}"? 🎵`,
    );
    await updateState(args.userId, {
      state: "awaiting_audio_confirm",
      pending_phrase: audioItem.target_language,
    });
  } else {
    await updateState(args.userId, { state: "active_free_chat" });
  }
}

// Mark the current lesson complete, advance curriculum_position to the next.
export async function advanceCurriculum(userId: string): Promise<void> {
  const memory = await getMemory(userId);
  const pos = memory.curriculum_position;
  if (!pos) return;

  const sb = getAdminClient();
  // Find the next lesson in this topic; if none, advance topic.
  const { data: nextInTopic } = await sb
    .from("lessons")
    .select("topic, lesson_number")
    .eq("language", "Spanish")
    .eq("level", memory.level ?? "beginner")
    .eq("topic", pos.current_topic ?? "")
    .gt("lesson_number", pos.current_lesson ?? 0)
    .order("lesson_number", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (nextInTopic) {
    await patchMemory(userId, {
      curriculum_position: {
        ...pos,
        current_lesson: nextInTopic.lesson_number,
      },
    });
    return;
  }

  // No more lessons in this topic — find the next topic.
  const { data: nextTopic } = await sb
    .from("lessons")
    .select("topic, lesson_number")
    .eq("language", "Spanish")
    .eq("level", memory.level ?? "beginner")
    .neq("topic", pos.current_topic ?? "")
    .order("topic", { ascending: true })
    .order("lesson_number", { ascending: true })
    .limit(1)
    .maybeSingle();

  await patchMemory(userId, {
    curriculum_position: {
      current_topic: nextTopic?.topic ?? pos.current_topic,
      current_lesson: nextTopic?.lesson_number ?? pos.current_lesson,
      completed_topics: [
        ...(pos.completed_topics ?? []),
        pos.current_topic ?? "",
      ].filter(Boolean),
    },
  });
}

// ── Internals ──────────────────────────────────────────────────────────────

async function fetchLesson(args: {
  language: string;
  level: string;
  topic: string;
  lessonNumber: number;
}): Promise<Lesson | null> {
  const sb = getAdminClient();
  const { data } = await sb
    .from("lessons")
    .select("*")
    .eq("language", args.language)
    .eq("level", args.level)
    .eq("topic", args.topic)
    .eq("lesson_number", args.lessonNumber)
    .maybeSingle();
  return (data as Lesson | null) ?? null;
}

async function formatLesson(
  lesson: Lesson,
  teacherId: string | null,
): Promise<string> {
  const systemPrompt = await getTeacherSystemPrompt(teacherId);

  const itemsSummary = lesson.content.items
    .map((i: LessonItem) => {
      if (i.type === "conjugation" && i.conjugation) {
        const lines = Object.entries(i.conjugation)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n");
        return `${i.target_language} (${i.native_language})\n${lines}`;
      }
      return `${i.target_language} — ${i.native_language}${i.pronunciation_guide ? ` (${i.pronunciation_guide})` : ""}`;
    })
    .join("\n");

  const result = await chatCompletion(
    [
      { role: "system", content: systemPrompt.replace("[MEMORY_JSON]", "{}").replace("[STATE]", "active_structured_lesson").replace("[LAST_20_MESSAGES]", "(none)") },
      {
        role: "user",
        content: `Format this lesson as a short WhatsApp message in your voice. Don't list every item — pick the most important 5–8, group naturally, use line breaks generously. End with offering to read the first phrase aloud (with 🎵). Keep it under 700 chars.

LESSON: ${lesson.title}
${lesson.content.introduction}

ITEMS:
${itemsSummary}

SUMMARY: ${lesson.content.summary}`,
      },
    ],
    { temperature: 0.7, max_tokens: 500 },
  );
  return result.trim();
}

async function getTeacherSystemPrompt(
  teacherId: string | null,
): Promise<string> {
  if (!teacherId) return "You are Chia, a Spanish teacher from Valencia.";
  const sb = getAdminClient();
  const { data } = await sb
    .from("teachers")
    .select("system_prompt")
    .eq("id", teacherId)
    .single();
  return (
    (data?.system_prompt as string) ??
    "You are Chia, a Spanish teacher from Valencia."
  );
}

// Re-export for possible future use; not currently consumed externally
export type { LessonContent };
