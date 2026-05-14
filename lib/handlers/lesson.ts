// Structured-lesson handler: pull the lesson the student is up to from the
// curriculum, format it for WhatsApp, send it, and offer audio for the
// first audio-worthy item.

import { sendText } from "@/lib/messaging/whatsapp";
import { chatCompletion } from "@/lib/messaging/openai";
import { getAdminClient } from "@/lib/supabase/admin";
import { getMemory, patchMemory } from "@/lib/handlers/memory";
import { updateState } from "@/lib/handlers/state";
import { logMessage } from "@/lib/handlers/messages";
import { getModulesForLevel } from "@/lib/handlers/curriculum";
import type { Lesson, LessonContent, LessonItem, Plan } from "@/types";

interface LessonArgs {
  userId: string;
  whatsappNumber: string;
  teacherId: string | null;
  userMessage: string;
  // Plan-gates the audio offer at the end of the lesson. Free
  // students see phonetic spellings only; premium gets the
  // "Want to hear me say...?" prompt that triggers awaiting_audio_confirm.
  userPlan?: Plan;
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
  await logMessage({
    userId: args.userId,
    role: "assistant",
    content: formatted,
  });

  // Plan-gated audio offer at the end of the lesson. Premium gets
  // "Want to hear me say...?"; free goes straight back to free chat
  // with no offer (mirrors the free-chat plan-gate so we don't
  // bait-and-switch in lessons either).
  const audioItem = lesson.content.items?.find((i) => i.audio_worthy);
  if (audioItem && args.userPlan === "premium") {
    const offer = `Want to hear me say "${audioItem.target_language}"? 🎵`;
    await sendText(args.whatsappNumber, offer);
    await logMessage({
      userId: args.userId,
      role: "assistant",
      content: offer,
    });
    await updateState(args.userId, {
      state: "awaiting_audio_confirm",
      pending_phrase: audioItem.target_language,
    });
  } else {
    // Free or no audio item — drop into free chat for follow-up
    // questions about the lesson. Free students who want voice will
    // see the "type 'upgrade' to hear me" nudge applied by the
    // free-chat handler on their next reply.
    await updateState(args.userId, { state: "active_free_chat" });
  }
}

// Mark the current lesson complete in user_lesson_progress, then
// advance curriculum_position to the next lesson (same topic if more
// remain, otherwise next topic). Idempotent — marking a lesson done
// twice is a no-op.
export async function advanceCurriculum(userId: string): Promise<void> {
  const memory = await getMemory(userId);
  const pos = memory.curriculum_position;
  if (!pos) return;

  const sb = getAdminClient();

  // Record current lesson as completed in user_lesson_progress.
  if (pos.current_topic && pos.current_lesson) {
    const { data: currentLesson } = await sb
      .from("lessons")
      .select("id")
      .eq("language", "Spanish")
      .eq("level", memory.level ?? "beginner")
      .eq("topic", pos.current_topic)
      .eq("lesson_number", pos.current_lesson)
      .maybeSingle();
    if (currentLesson?.id) {
      await sb
        .from("user_lesson_progress")
        .upsert(
          {
            user_id: userId,
            lesson_id: currentLesson.id,
            status: "completed",
            completed_at: new Date().toISOString(),
          },
          { onConflict: "user_id,lesson_id", ignoreDuplicates: false },
        );
    }
  }

  // Find the next lesson, respecting MODULE ordering:
  //   1. Next lesson_number in same topic
  //   2. If topic exhausted, next topic in same module
  //   3. If module exhausted, first topic in next module
  //   4. If level exhausted, leave pointer where it is (we may
  //      advance to next level in a future commit)
  const level = memory.level ?? "beginner";
  const modules = getModulesForLevel(level);

  // Build a flat topic sequence from modules: [topic1, topic2, ...]
  // ordered by module index then topic index within module.
  const topicSequence: string[] = modules.flatMap((m) => m.topics);

  // Locate the current topic in the sequence.
  const currentTopic = pos.current_topic ?? "";
  const currentIdx = topicSequence.indexOf(currentTopic);

  // Step 1: try next lesson in same topic.
  const { data: nextInTopic } = await sb
    .from("lessons")
    .select("topic, lesson_number")
    .eq("language", "Spanish")
    .eq("level", level)
    .eq("topic", currentTopic)
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

  // Step 2+: walk forward through the topic sequence and pick the
  // first topic that has at least one lesson (some topics in the
  // spec might not yet have generated lessons — skip those).
  for (let i = currentIdx + 1; i < topicSequence.length; i++) {
    const nextTopic = topicSequence[i];
    const { data: firstLesson } = await sb
      .from("lessons")
      .select("topic, lesson_number")
      .eq("language", "Spanish")
      .eq("level", level)
      .eq("topic", nextTopic)
      .order("lesson_number", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (firstLesson) {
      await patchMemory(userId, {
        curriculum_position: {
          current_topic: firstLesson.topic,
          current_lesson: firstLesson.lesson_number,
          completed_topics: [
            ...(pos.completed_topics ?? []),
            currentTopic,
          ].filter(Boolean),
        },
      });
      return;
    }
  }

  // Fallback for topics not yet in any module — find any lesson in
  // a topic the student hasn't already worked on. Catches lessons
  // that pre-date the modules system or have a typo in the topic key.
  const { data: orphan } = await sb
    .from("lessons")
    .select("topic, lesson_number")
    .eq("language", "Spanish")
    .eq("level", level)
    .neq("topic", currentTopic)
    .order("topic", { ascending: true })
    .order("lesson_number", { ascending: true })
    .limit(1)
    .maybeSingle();

  await patchMemory(userId, {
    curriculum_position: {
      current_topic: orphan?.topic ?? currentTopic,
      current_lesson: orphan?.lesson_number ?? pos.current_lesson,
      completed_topics: [
        ...(pos.completed_topics ?? []),
        currentTopic,
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

  const filledSystem = systemPrompt
    .replace("[MEMORY_JSON]", "{}")
    .replace("[STATE]", "active_structured_lesson")
    .replace("[LAST_20_MESSAGES]", "(none)");

  const result = await chatCompletion(
    [
      { role: "system", content: filledSystem },
      {
        role: "user",
        content: `Format this lesson as a short WhatsApp message in your voice. Don't list every item — pick the most important 5–8, group naturally, use line breaks generously. End by offering to say the first phrase aloud using EXACTLY this pattern: Want to hear me say "[phrase]"? 🎵 — keep the whole message under 700 chars.

LESSON: ${lesson.title}
${lesson.content.introduction}

ITEMS:
${itemsSummary}

SUMMARY: ${lesson.content.summary}`,
      },
    ],
    {
      model: process.env.CHIA_PERSONALITY_MODEL ?? "gpt-4o",
      temperature: 0.85,
      max_tokens: 500,
    },
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
