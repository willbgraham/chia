// Curriculum overview helpers — used by the free-chat intent
// handlers to answer questions like:
//   - "show me the curriculum"
//   - "what's left to learn?"
//   - "what have I learned so far?"
//   - "what are we covering next?"
//
// All of these read from public.lessons + public.user_lesson_progress.
// memory_json.curriculum_position points at the student's CURRENT
// lesson; everything before that pointer (within the same level) is
// considered completed; everything after is upcoming.

import { getAdminClient } from "@/lib/supabase/admin";

export interface LessonSummary {
  id: string;
  topic: string;
  lesson_number: number;
  title: string;
  completed: boolean;
  current: boolean;
}

// Full curriculum at the student's level, with completion + current
// flags. Sorted by topic then lesson_number, which matches how
// advanceCurriculum walks the sequence.
export async function getCurriculumForUser(
  userId: string,
  level: string,
): Promise<LessonSummary[]> {
  const sb = getAdminClient();

  // Load the full level's lesson catalog.
  const { data: lessons } = await sb
    .from("lessons")
    .select("id, topic, lesson_number, title")
    .eq("language", "Spanish")
    .eq("level", level)
    .order("topic", { ascending: true })
    .order("lesson_number", { ascending: true });

  // Load the user's completed lessons.
  const { data: progress } = await sb
    .from("user_lesson_progress")
    .select("lesson_id, status")
    .eq("user_id", userId)
    .eq("status", "completed");
  const completedIds = new Set((progress ?? []).map((p) => p.lesson_id));

  // Load the user's current curriculum_position.
  const { data: user } = await sb
    .from("users")
    .select("memory_json")
    .eq("id", userId)
    .single();
  const pos =
    (user?.memory_json as {
      curriculum_position?: { current_topic?: string; current_lesson?: number };
    } | null)?.curriculum_position ?? {};
  const currentTopic = pos.current_topic ?? null;
  const currentLesson = pos.current_lesson ?? null;

  return ((lessons ?? []) as Array<{
    id: string;
    topic: string;
    lesson_number: number;
    title: string;
  }>).map((l) => ({
    id: l.id,
    topic: l.topic,
    lesson_number: l.lesson_number,
    title: l.title,
    completed: completedIds.has(l.id),
    current: l.topic === currentTopic && l.lesson_number === currentLesson,
  }));
}

// Build a chat-friendly summary of the curriculum. Used in Chia's
// reply when the student asks "what are we learning". Keep it
// digestible — group by topic, show progress within each.
export function formatCurriculumForChat(
  lessons: LessonSummary[],
  level: string,
): string {
  if (lessons.length === 0) {
    return `I don't have any ${level} lessons set up yet 🌿 We can just chat — I'll teach you as we go.`;
  }

  // Group by topic, preserving the topic order from the input array.
  const byTopic = new Map<string, LessonSummary[]>();
  for (const l of lessons) {
    if (!byTopic.has(l.topic)) byTopic.set(l.topic, []);
    byTopic.get(l.topic)!.push(l);
  }

  const lines: string[] = [];
  for (const [topic, topicLessons] of byTopic) {
    const completed = topicLessons.filter((l) => l.completed).length;
    const total = topicLessons.length;
    const hasCurrent = topicLessons.some((l) => l.current);
    const dot = hasCurrent ? "🟢" : completed === total ? "✅" : "•";
    const title = humanizeTopic(topic);
    lines.push(`${dot} *${title}* (${completed}/${total})`);
  }

  const completedTotal = lessons.filter((l) => l.completed).length;
  return [
    `Here's our ${level} curriculum, ${completedTotal}/${lessons.length} done 🌿`,
    "",
    ...lines,
    "",
    `Type *next lesson* to start the next one, or just tell me what you want to learn.`,
  ].join("\n");
}

// Build a "what have I learned" summary: counts + a handful of
// recent completed lesson titles.
export function formatProgressForChat(
  lessons: LessonSummary[],
  level: string,
): string {
  const completed = lessons.filter((l) => l.completed);
  if (completed.length === 0) {
    return `We haven't completed any ${level} lessons yet 🌿 Tell me "next lesson" and we'll start one.`;
  }
  const recent = completed.slice(-5).reverse();
  const recentList = recent.map((l) => `· ${l.title}`).join("\n");
  return [
    `So far we've done ${completed.length} ${level} lessons 🌿`,
    "",
    `Recent ones:`,
    recentList,
    "",
    `Want to keep going? Type *next lesson* or ask me anything specific you want to review.`,
  ].join("\n");
}

function humanizeTopic(topic: string): string {
  return topic
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}
