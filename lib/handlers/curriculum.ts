// Curriculum overview helpers — used by the free-chat intent
// handlers to answer questions like:
//   - "show me the curriculum"
//   - "what's left to learn?"
//   - "what have I learned so far?"
//   - "what are we covering next?"
//
// Curriculum is organized in MODULES (defined in
// data/curriculum-modules.json). Each module groups related topics
// for one level. Students progress: lesson → topic → module → level.
//
// Reads from public.lessons + public.user_lesson_progress.
// memory_json.curriculum_position points at the student's CURRENT
// lesson.

import { readFileSync } from "node:fs";
import path from "node:path";
import { getAdminClient } from "@/lib/supabase/admin";

// ── Module config loading ─────────────────────────────────────────
interface ModuleSpec {
  name: string;
  description: string;
  topics: string[];
}
interface ModuleConfig {
  modules: Record<string, ModuleSpec[]>;
}

let _moduleConfig: ModuleConfig | null = null;
function loadModuleConfig(): ModuleConfig {
  if (_moduleConfig) return _moduleConfig;
  const raw = readFileSync(
    path.join(process.cwd(), "data", "curriculum-modules.json"),
    "utf8",
  );
  _moduleConfig = JSON.parse(raw) as ModuleConfig;
  return _moduleConfig;
}

export function getModulesForLevel(level: string): ModuleSpec[] {
  return loadModuleConfig().modules[level] ?? [];
}

// Build a (topic → moduleIndex) lookup for fast grouping + a
// (topic → topicOrder-within-module) lookup for progression sequencing.
export function buildTopicOrder(level: string): {
  moduleIndexByTopic: Map<string, number>;
  topicOrderByTopic: Map<string, number>;
} {
  const modules = getModulesForLevel(level);
  const moduleIndexByTopic = new Map<string, number>();
  const topicOrderByTopic = new Map<string, number>();
  modules.forEach((mod, mIdx) => {
    mod.topics.forEach((topic, tIdx) => {
      moduleIndexByTopic.set(topic, mIdx);
      topicOrderByTopic.set(topic, tIdx);
    });
  });
  return { moduleIndexByTopic, topicOrderByTopic };
}

export interface LessonSummary {
  id: string;
  topic: string;
  lesson_number: number;
  title: string;
  completed: boolean;
  current: boolean;
}

export interface ModuleSummary {
  name: string;
  description: string;
  topics: string[];
  lessons: LessonSummary[];
  totalLessons: number;
  completedLessons: number;
  isCurrent: boolean;
  isComplete: boolean;
}

// Full curriculum at the student's level, with completion + current
// flags. Returned as a flat array (legacy callers) sorted by module
// order → topic order → lesson_number.
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

  const rawLessons = ((lessons ?? []) as Array<{
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

  // Sort by module order (from curriculum-modules.json), then topic
  // order within module, then lesson_number. Topics not in any module
  // get sorted last (alphabetically) so they don't disappear.
  const { moduleIndexByTopic, topicOrderByTopic } = buildTopicOrder(level);
  return rawLessons.sort((a, b) => {
    const aMod = moduleIndexByTopic.get(a.topic) ?? 999;
    const bMod = moduleIndexByTopic.get(b.topic) ?? 999;
    if (aMod !== bMod) return aMod - bMod;
    const aTop = topicOrderByTopic.get(a.topic) ?? 999;
    const bTop = topicOrderByTopic.get(b.topic) ?? 999;
    if (aTop !== bTop) return aTop - bTop;
    if (a.topic !== b.topic) return a.topic.localeCompare(b.topic);
    return a.lesson_number - b.lesson_number;
  });
}

// Group a flat lesson list by module, using the modules defined
// for this level in curriculum-modules.json. Lessons whose topic
// isn't in any module land in an "Other" bucket appended at the
// end so they're still visible.
export function groupByModule(
  lessons: LessonSummary[],
  level: string,
): ModuleSummary[] {
  const modules = getModulesForLevel(level);
  const byTopic = new Map<string, LessonSummary[]>();
  for (const l of lessons) {
    if (!byTopic.has(l.topic)) byTopic.set(l.topic, []);
    byTopic.get(l.topic)!.push(l);
  }

  const out: ModuleSummary[] = [];
  const usedTopics = new Set<string>();
  for (const mod of modules) {
    const modLessons: LessonSummary[] = [];
    for (const topic of mod.topics) {
      const ls = byTopic.get(topic);
      if (!ls) continue;
      usedTopics.add(topic);
      modLessons.push(...ls);
    }
    const completed = modLessons.filter((l) => l.completed).length;
    const total = modLessons.length;
    const isCurrent = modLessons.some((l) => l.current);
    out.push({
      name: mod.name,
      description: mod.description,
      topics: mod.topics,
      lessons: modLessons,
      totalLessons: total,
      completedLessons: completed,
      isCurrent,
      isComplete: total > 0 && completed === total,
    });
  }

  // Catch any lessons whose topic isn't mapped to a module yet.
  const orphans: LessonSummary[] = [];
  for (const [topic, ls] of byTopic) {
    if (!usedTopics.has(topic)) orphans.push(...ls);
  }
  if (orphans.length > 0) {
    const completed = orphans.filter((l) => l.completed).length;
    out.push({
      name: "Other",
      description: "Lessons not yet assigned to a module.",
      topics: Array.from(new Set(orphans.map((l) => l.topic))),
      lessons: orphans,
      totalLessons: orphans.length,
      completedLessons: completed,
      isCurrent: orphans.some((l) => l.current),
      isComplete: completed === orphans.length,
    });
  }

  return out;
}

// Build a chat-friendly summary of the curriculum, organized by
// MODULE. Each module is one line; the current module gets the
// topic-level detail underneath for context.
export function formatCurriculumForChat(
  lessons: LessonSummary[],
  level: string,
): string {
  if (lessons.length === 0) {
    return `I don't have any ${humanLevel(level)} lessons set up yet 🌿 We can just chat — I'll teach you as we go.`;
  }

  const completedTotal = lessons.filter((l) => l.completed).length;
  const modules = groupByModule(lessons, level);
  if (modules.length === 0) {
    // No modules defined for this level (edge case) — fall back to
    // the flat list with a small marker so we don't return empty.
    return `${humanLevel(level)} curriculum 🌿 (${completedTotal}/${lessons.length} done)\n\nType *next lesson* to start.`;
  }

  const lines: string[] = [];
  lines.push(
    `*${humanLevel(level)} Spanish* 🌿 (${completedTotal}/${lessons.length} lessons done)`,
  );
  lines.push("");

  modules.forEach((mod, idx) => {
    const dot = mod.isComplete ? "✅" : mod.isCurrent ? "🟢" : "○";
    const num = idx + 1;
    lines.push(
      `${dot} *Module ${num}: ${mod.name}* (${mod.completedLessons}/${mod.totalLessons})`,
    );
    // For the current module, drill into the topic-level progress so
    // the student sees what's right ahead.
    if (mod.isCurrent) {
      const byTopic = new Map<string, LessonSummary[]>();
      for (const l of mod.lessons) {
        if (!byTopic.has(l.topic)) byTopic.set(l.topic, []);
        byTopic.get(l.topic)!.push(l);
      }
      for (const [topic, topicLessons] of byTopic) {
        const c = topicLessons.filter((l) => l.completed).length;
        const t = topicLessons.length;
        const cur = topicLessons.some((l) => l.current);
        const tDot = c === t ? "✅" : cur ? "→" : "·";
        lines.push(`    ${tDot} ${humanizeTopic(topic)} (${c}/${t})`);
      }
    }
  });

  lines.push("");
  lines.push(
    `Type *next lesson* to continue, or *quiz me* to test what you've covered.`,
  );
  return lines.join("\n");
}

function humanLevel(level: string): string {
  if (level === "beginner") return "Beginner (A1)";
  if (level === "intermediate") return "Intermediate (A2)";
  if (level === "advanced") return "Advanced (B1)";
  return level.charAt(0).toUpperCase() + level.slice(1);
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
