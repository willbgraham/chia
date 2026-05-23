// Shared types for the ChiaChat admin dashboard and webhook handlers.
// Database row shapes mirror supabase/schema.sql exactly.

export type Plan = "free" | "premium";
export type Gender = "female" | "male";
export type ReminderPreference = "daily" | "few_days" | "none";
export type Level = "beginner" | "intermediate" | "advanced";
export type LessonMode = "structured" | "free" | "both";
export type AudioSource = "make_tts" | "elevenlabs_agent";
export type AudioDirection = "outbound" | "inbound";
export type ProgressStatus = "not_started" | "in_progress" | "completed";
export type ImageContext =
  | "morning"
  | "evening"
  | "happy"
  | "thoughtful"
  | "location"
  | "lesson"
  | "celebration"
  | "correction"
  | "greeting"
  | "general";

export type ConversationStateName =
  | "onboarding_step_1"
  | "onboarding_step_2"
  | "onboarding_step_3"
  | "onboarding_step_4"
  | "onboarding_step_5"
  | "onboarding_step_6"
  | "onboarding_step_7"
  | "active_free_chat"
  | "active_structured_lesson"
  | "awaiting_audio_confirm"
  | "awaiting_voice_note"
  | "awaiting_quiz_answer"
  | "awaiting_module_quiz"
  | "idle";

// ── Memory JSON ────────────────────────────────────────────────────────────
// Stored in users.memory_json. This is the single source of truth Chia
// reads from on every text turn and that the ElevenLabs agent webhook
// updates after every voice exchange.
export interface MemoryJson {
  name?: string;
  native_language?: string;
  level?: Level;
  lesson_mode?: LessonMode;
  reminder_preference?: ReminderPreference;
  reminder_time?: string;
  plan?: Plan;
  personal?: {
    job?: string | null;
    location?: string | null;
    interests?: string[];
    mentioned?: string[];
  };
  language_progress?: {
    weak_points?: string[];
    strong_points?: string[];
    repeated_mistakes?: string[];
    pronunciation_notes?: string[];
  };
  milestones?: string[];
  curriculum_position?: {
    current_topic?: string;
    current_lesson?: number;
    completed_topics?: string[];
  };
  inside_references?: string[];
  last_session?: string;
  streak_days?: number;
  // ── Module-quiz state (end-of-module checkpoint) ────────────────────────
  // pending_module_quiz: ephemeral state for an in-progress checkpoint
  // quiz. Cleared on completion/skip. See lib/handlers/module-quiz.ts
  // for the PendingModuleQuiz shape.
  pending_module_quiz?: unknown;
  // completed_module_quizzes: keys like "advanced::5" (level::moduleIdx).
  // Tracks which modules we've already prompted a checkpoint quiz for —
  // prevents re-prompting the same module on every "next lesson".
  completed_module_quizzes?: string[];
}

// ── Lesson content JSON ────────────────────────────────────────────────────
export type LessonItemType = "vocabulary" | "conjugation" | "phrase" | "rule";

export interface LessonItem {
  type: LessonItemType;
  target_language: string;
  native_language: string;
  pronunciation_guide?: string;
  notes?: string;
  audio_worthy: boolean;
  // For conjugation items, an optional table of forms.
  conjugation?: Record<string, string>;
}

export interface LessonContent {
  introduction: string;
  items: LessonItem[];
  summary: string;
  practice_prompts: string[];
}

// ── Database row types ─────────────────────────────────────────────────────
export interface Teacher {
  id: string;
  name: string;
  language: string;
  gender: Gender | null;
  nationality: string | null;
  age: number | null;
  whatsapp_number: string | null;
  elevenlabs_voice_id: string | null;
  elevenlabs_agent_id: string | null;
  system_prompt: string | null;
  agent_voice_prompt: string | null;
  backstory: string | null;
  profile_image_url: string | null;
  is_active: boolean;
  created_at: string;
}

export interface User {
  id: string;
  whatsapp_number: string;
  teacher_id: string | null;
  plan: Plan;
  memory_json: MemoryJson;
  reminder_preference: ReminderPreference;
  reminder_time: string | null;
  billing_period_start: string | null;
  stripe_customer_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationState {
  id: string;
  user_id: string;
  state: ConversationStateName;
  pending_phrase: string | null;
  pending_audio_url: string | null;
  last_message_at: string;
  updated_at: string;
}

export interface AudioUsageRow {
  id: string;
  user_id: string;
  characters_used: number;
  source: AudioSource | null;
  direction: AudioDirection | null;
  created_at: string;
}

export interface TeacherImage {
  id: string;
  teacher_id: string;
  storage_url: string;
  tags: string[];
  context: ImageContext | null;
  created_at: string;
}

export interface Lesson {
  id: string;
  language: string;
  level: string;
  topic: string;
  lesson_number: number;
  title: string;
  content: LessonContent;
  created_at: string;
}

export interface UserLessonProgress {
  id: string;
  user_id: string;
  lesson_id: string;
  status: ProgressStatus;
  completed_at: string | null;
  notes: string | null;
}

// ── Webhook payloads ───────────────────────────────────────────────────────
export interface ElevenLabsWebhookBody {
  whatsapp_number: string;
  transcription: string;
  agent_response: string;
  session_id: string;
  characters_used?: {
    stt?: number;
    tts?: number;
  };
}

// ── Plan limits ────────────────────────────────────────────────────────────
export const AUDIO_LIMITS: Record<Plan, number> = {
  free: 0,
  premium: 50_000,
};
