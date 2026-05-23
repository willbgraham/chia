// Free-chat handler: build the GPT prompt with Chia's system prompt + memory
// + recent messages, send the response. If the response offers audio, store
// the target phrase in pending_phrase and switch state.

import { sendText, sendImage, sendDocument } from "@/lib/messaging/whatsapp";
import { chiaTextTurn, chatCompletion } from "@/lib/messaging/openai";
import { getAdminClient } from "@/lib/supabase/admin";
import { getMemory, patchMemory } from "@/lib/handlers/memory";
import { updateState } from "@/lib/handlers/state";
import { accountUrl, curriculumUrl } from "@/lib/account/magic-link";
import { pickContextualPhoto } from "@/lib/handlers/photo-pick";
import { logMessage, findRelevantMessages } from "@/lib/handlers/messages";
import { handleLesson, advanceCurriculum } from "@/lib/handlers/lesson";
import {
  maybeWantsPDF,
  pickPDFForRequest,
} from "@/lib/handlers/pdf-pick";
import { getOrGeneratePDF } from "@/lib/handlers/pdf-cache";
import {
  getCurriculumForUser,
  formatCurriculumForChat,
  formatProgressForChat,
} from "@/lib/handlers/curriculum";
import { sendQuiz } from "@/lib/handlers/quiz";

interface FreeChatArgs {
  userId: string;
  whatsappNumber: string;
  teacherId: string | null;
  userPlan: "free" | "premium";
  userMessage: string;
  // Optional — only callers that have it (route-message, voice-note,
  // audio-confirm) plumb it through. Used by the manual module-quiz
  // trigger to gate the audio quota for the listening quiz.
  billingPeriodStart?: string | null;
}

export async function handleFreeChat(args: FreeChatArgs): Promise<void> {
  // Lesson advancement intent — fast path. If the student says
  // "next lesson" / "teach me" / etc., skip the GPT chat reply
  // entirely and route them straight into the structured lesson
  // flow. Far better UX than Chia chatting about it then the lesson
  // arriving as a separate message.
  if (wantsNextLesson(args.userMessage)) {
    await startOrAdvanceLesson(args);
    return;
  }

  // Curriculum overview intents: "what are we learning" / "show me
  // the curriculum" / "what's left" → curriculum list.
  if (wantsCurriculumOverview(args.userMessage)) {
    await sendCurriculumOverview(args);
    return;
  }
  // "What have I learned" / "my progress" / "how am I doing" →
  // progress summary.
  if (wantsProgressSummary(args.userMessage)) {
    await sendProgressSummary(args);
    return;
  }
  // "Where were we" / "continue lesson" / "pick up" → resume the
  // current lesson without advancing (vs. wantsNextLesson which
  // advances past it).
  if (wantsResumeLesson(args.userMessage)) {
    await resumeCurrentLesson(args);
    return;
  }
  // Module checkpoint quiz (manual trigger). Bigger than the single
  // pop quiz — runs 3 questions of the chosen type (Reading / Listening
  // / Speaking) on the student's current module. The auto-trigger fires
  // from startOrAdvanceLesson; this is the "let me try it again" entry.
  const moduleQuizIntent = matchModuleQuizIntent(args.userMessage);
  if (moduleQuizIntent !== null) {
    await launchManualModuleQuiz({
      userId: args.userId,
      whatsappNumber: args.whatsappNumber,
      userPlan: args.userPlan,
      billingPeriodStart: args.billingPeriodStart ?? null,
      specificType: moduleQuizIntent === "any" ? null : moduleQuizIntent,
    });
    return;
  }

  // "Quiz me" / "test me" / "pop quiz" → send an interactive
  // multiple-choice question pulled from a completed (or current)
  // lesson item. Answer flows through the awaiting_quiz_answer
  // state machine.
  if (wantsQuiz(args.userMessage)) {
    await sendQuiz({
      userId: args.userId,
      whatsappNumber: args.whatsappNumber,
      userPlan: args.userPlan,
    });
    return;
  }

  const memory = await getMemory(args.userId);

  const systemPrompt = await getTeacherSystemPrompt(args.teacherId);
  const recent = await getRecentMessages(args.userId);

  // Long-range memory retrieval: pgvector finds the K most semantically
  // similar past messages from this user (excluding the last 30min,
  // which are already in the rolling buffer above). Best-effort —
  // if the embedding API fails we just skip the long-range injection.
  // Cost: ~$0.0001 per turn; latency: ~150-300ms.
  const relevant = await findRelevantMessages(args.userId, args.userMessage, 5);
  const relevantHistory = relevant.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const rawReply = await chiaTextTurn({
    systemPromptTemplate: systemPrompt,
    memoryJson: memory,
    state: "active_free_chat",
    recentMessages: recent,
    relevantHistory,
    userMessage: args.userMessage,
    userPlan: args.userPlan,
  });

  // For free users, we belt-and-braces the plan gating: even if GPT
  // slips and offers audio in spite of the system_prompt instruction,
  // we strip the offer line server-side before it reaches the student
  // — and replace it with a soft "type 'upgrade' to hear me" nudge.
  // This is the fix for the bait-and-switch bug where students said
  // "yes" to an audio offer and got "voice is Premium" back.
  const { reply, audioOfferStripped } = applyFreePlanGuard(
    rawReply,
    args.userPlan,
  );

  await sendText(args.whatsappNumber, reply);
  // Update both stores: rolling buffer (fast path for next GPT turn)
  // and the permanent messages table (admin viewer + future features).
  await appendMessage(args.userId, "user", args.userMessage);
  await appendMessage(args.userId, "assistant", reply);
  await logMessage({ userId: args.userId, role: "user", content: args.userMessage });
  await logMessage({ userId: args.userId, role: "assistant", content: reply });

  // Detect upgrade intent — if the student is on free and asks to
  // upgrade, send them the Stripe payment link as a follow-up message.
  if (args.userPlan === "free" && wantsUpgrade(args.userMessage)) {
    await sendUpgradeLink(args.whatsappNumber, args.userId);
  }

  // Detect account-management intent — "cancel", "manage", "account",
  // "support", etc. → send a magic link to /account/<token> where
  // they can manage their plan, view what Chia knows about them, or
  // contact support. Works for both free and premium.
  if (wantsAccount(args.userMessage)) {
    await sendAccountLink(args.whatsappNumber, args.userId, args.userPlan);
  }

  // Audio confirmation flow runs ONLY for premium users. For free users
  // we already stripped any offer above, so the student never sees one
  // and the awaiting_audio_confirm state never gets entered.
  if (args.userPlan === "premium") {
    const phrase = await extractTargetPhrase(reply);
    if (phrase) {
      await updateState(args.userId, {
        state: "awaiting_audio_confirm",
        pending_phrase: phrase,
      });
    }
  }

  // PDF document delivery (premium only). Cheap regex pre-filter
  // skips the GPT classifier on most turns. When a student asks for
  // a cheat sheet / conjugation table / pickup lines etc., the
  // classifier picks the best match from the catalog and the PDF
  // gets sent via Meta sendDocument. Free users see a soft nudge
  // pointing at the upgrade page.
  if (maybeWantsPDF(args.userMessage)) {
    if (args.userPlan === "premium") {
      try {
        const pick = await pickPDFForRequest(args.userMessage);
        if (pick) {
          const pdf = await getOrGeneratePDF(pick.kind, pick.subject);
          await sendDocument(
            args.whatsappNumber,
            pdf.publicUrl,
            pdf.filename,
          );
          await logMessage({
            userId: args.userId,
            role: "assistant",
            content: `[pdf: ${pick.kind}/${pick.subject}]`,
          });
        }
      } catch (err) {
        console.error("[free-chat] pdf send failed:", err);
      }
    } else {
      // Free user asked for a PDF — soft nudge, no link in chat
      // (the free-plan-guard nudge already added "type 'upgrade'"
      // earlier in this turn if it stripped an audio offer).
      // We add an explicit nudge here too because PDFs come up less
      // often and the student just made a specific request.
      const baseUrl =
        process.env.NEXT_PUBLIC_APP_URL ?? "https://chiachat.com";
      const upgradeUrl = `${baseUrl.replace(/\/+$/, "")}/upgrade?ref=${encodeURIComponent(args.userId)}`;
      await sendText(
        args.whatsappNumber,
        `Cheat sheets are part of Premium 🌿 — €25/month gets you PDFs, voice, and pronunciation:\n\n${upgradeUrl}`,
      );
    }
  }

  // Mid-conversation photo (premium only). Best-effort — failure
  // doesn't affect the chat. Skip if state has just been set to
  // awaiting_audio_confirm: the audio offer is already a moment of
  // its own and stacking a photo on top is overkill.
  if (args.userPlan === "premium" && args.teacherId) {
    try {
      const photo = await pickContextualPhoto({
        userId: args.userId,
        teacherId: args.teacherId,
        chiaReply: reply,
        studentMessage: args.userMessage,
      });
      if (photo) {
        await sendImage(args.whatsappNumber, photo.storageUrl);
        await logMessage({
          userId: args.userId,
          role: "assistant",
          content: `[photo: ${photo.context ?? "general"}]`,
          imageUrl: photo.storageUrl,
        });
      }
    } catch (err) {
      console.error("[free-chat] photo send failed:", err);
    }
  }

  // (audioOfferStripped intentionally unused — kept for future analytics)
  void audioOfferStripped;
}

// Strip the "Want to hear me say ...? 🎵" line for free users and
// replace it with a single concise nudge. Premium users pass through
// unchanged. Returns the cleaned reply + whether we actually stripped.
//
// We intentionally over-match here — anything that looks like Chia
// offering audio gets cut, even if the exact phrasing varies (the
// audio protocol asks for a specific pattern but GPT occasionally
// improvises). Better to drop a few false positives than to let the
// bait-and-switch land on a paying-considering free user.
function applyFreePlanGuard(
  reply: string,
  userPlan: "free" | "premium",
): { reply: string; audioOfferStripped: boolean } {
  if (userPlan === "premium") {
    return { reply, audioOfferStripped: false };
  }

  // Match any line containing "want to hear me say" / "hear it from me"
  // / similar phrasing, optionally followed by a music-note emoji.
  // Multi-line, case-insensitive, m-flag for ^/$ on each line.
  const offerPattern =
    /(?:^|\n)\s*(?:Want to hear me say|Want to hear it|Hear me say|Let me say)[^\n]*?(?:🎵|🎶|🎼|\?|$)[^\n]*$/gim;

  const stripped = reply.replace(offerPattern, "").trimEnd();

  if (stripped === reply.trim() || stripped === reply) {
    return { reply, audioOfferStripped: false };
  }

  // Append a soft nudge — "type 'upgrade' to hear me". Done at most
  // once per reply. Concise on purpose so it doesn't feel preachy.
  const nudge =
    "\n\n_(Want to hear me say these? Type \"upgrade\" 🌿)_";
  return {
    reply: `${stripped}${nudge}`,
    audioOfferStripped: true,
  };
}

async function extractTargetPhrase(reply: string): Promise<string | null> {
  // Single-shot GPT classifier — return just the Spanish phrase Chia
  // offered to read aloud, or empty if she didn't actually offer one.
  const out = await chatCompletion(
    [
      {
        role: "system",
        content:
          'Extract the Spanish phrase the teacher just offered to read aloud. Return only the phrase verbatim, with no quotation marks or explanation. If no phrase was offered, return the empty string.',
      },
      { role: "user", content: reply },
    ],
    { temperature: 0, max_tokens: 60 },
  );
  const phrase = out.trim().replace(/^["'`]|["'`]$/g, "");
  if (phrase.length === 0 || phrase.length > 200) return null;
  return phrase;
}

// Match common ways students ask to upgrade. Conservative — false negatives
// (Chia just keeps chatting) are fine; false positives (link sent unnecessarily)
// are not.
function wantsUpgrade(message: string): boolean {
  const t = message.toLowerCase();
  const triggers = [
    "upgrade",
    "premium",
    "subscribe",
    "subscription",
    "pay for",
    "go pro",
    "pricing",
    "how much",
    "i want voice",
    "unlock voice",
    "want premium",
  ];
  return triggers.some((kw) => t.includes(kw));
}

// "Next lesson" / "teach me" intent — student in free chat asking
// to switch into a structured lesson, or to advance to the next one
// if they already have a curriculum position.
function wantsNextLesson(message: string): boolean {
  const t = message.toLowerCase();
  const triggers = [
    "next lesson",
    "another lesson",
    "give me a lesson",
    "teach me",
    "lesson please",
    "let's do a lesson",
    "do a lesson",
    "more lessons",
    "next topic",
    "start a lesson",
    "begin a lesson",
    "i want to learn",
    "teach me something",
  ];
  return triggers.some((kw) => t.includes(kw));
}

// "Show me the course / agenda / lesson list" — overview of the
// full curriculum at the student's level. Also fires when the
// student asks for "the link" / "send me a link" since the
// curriculum dashboard is the most common thing they'd want a
// link to from Chia.
function wantsCurriculumOverview(message: string): boolean {
  const t = message.toLowerCase();
  const triggers = [
    // Direct words for the course concept
    "curriculum",
    "syllabus",
    "agenda",

    // Course-related phrases
    "my course",
    "the course",
    "full course",
    "course outline",
    "course overview",
    "course agenda",
    "course link",
    "course list",
    "the program",
    "the programme",

    // Lesson-collection phrases
    "lesson list",
    "lessons list",
    "list of lessons",
    "all lessons",
    "all the lessons",
    "all my lessons",
    "see all lessons",
    "see the lessons",
    "see my lessons",
    "show me the lessons",
    "show all lessons",
    "lesson overview",
    "lesson link",
    "lessons link",

    // Link / send-me variants — students often just want the URL
    "send me the link",
    "send me a link",
    "send me the lessons",
    "send me my lessons",
    "give me the link",
    "share the link",
    "link to my lessons",
    "link to my course",
    "link to the course",
    "link to lessons",

    // "Show me my course"
    "show me my course",
    "show me the course",
    "see my course",

    // "What are we learning" variants
    "what are we learning",
    "what will we learn",
    "what we're learning",
    "what we are learning",
    "what's left",
    "what is left",
    "what's next",
    "what is next",
    "what comes next",
    "what topics",
    "what are we going to cover",
    "what are we covering",
    "what's coming",
    "what's coming up",
  ];
  return triggers.some((kw) => t.includes(kw));
}

async function sendCurriculumOverview(args: FreeChatArgs): Promise<void> {
  const memory = await getMemory(args.userId);
  const level = memory.level ?? "beginner";
  const lessons = await getCurriculumForUser(args.userId, level);
  const overview = formatCurriculumForChat(lessons, level);
  // Append a short magic-link to the visual curriculum dashboard
  // so students can tap into a real syllabus view + check off
  // lessons. createShortLink fits the URL on one WhatsApp line.
  const link = await curriculumUrl(args.userId);
  const text =
    `${overview}\n\n` +
    `📱 *Full visual view + check off what you've learned:*\n${link}\n` +
    `_(link valid for 24h — message me "curriculum" again for a fresh one)_`;
  await sendText(args.whatsappNumber, text);
  await logMessage({
    userId: args.userId,
    role: "user",
    content: args.userMessage,
  });
  await logMessage({
    userId: args.userId,
    role: "assistant",
    content: text,
  });
}

// "What have I learned" — short summary of progress.
function wantsProgressSummary(message: string): boolean {
  const t = message.toLowerCase();
  const triggers = [
    "what have i learned",
    "what i've learned",
    "my progress",
    "show my progress",
    "show me my progress",
    "how am i doing",
    "how am i progressing",
    "how is my progress",
    "what i've covered",
    "what we've covered",
    "what have we covered",
    "where am i at",
    "where am i in the course",
    "lessons done",
    "lessons completed",
    "completed lessons",
    "my stats",
    "my progress so far",
  ];
  return triggers.some((kw) => t.includes(kw));
}

async function sendProgressSummary(args: FreeChatArgs): Promise<void> {
  const memory = await getMemory(args.userId);
  const level = memory.level ?? "beginner";
  const lessons = await getCurriculumForUser(args.userId, level);
  const summary = formatProgressForChat(lessons, level);
  // Same link as the curriculum overview — once they're looking at
  // their progress, the next click should be the full visual dashboard.
  const link = await curriculumUrl(args.userId);
  const text =
    `${summary}\n\n` +
    `📱 *Full course + check-offs:*\n${link}\n` +
    `_(link valid for 24h)_`;
  await sendText(args.whatsappNumber, text);
  await logMessage({
    userId: args.userId,
    role: "user",
    content: args.userMessage,
  });
  await logMessage({
    userId: args.userId,
    role: "assistant",
    content: text,
  });
}

// Module checkpoint quiz trigger. Returns "reading"/"listening"/"speaking"
// if they named a specific type, "any" if they used a generic phrase, or
// null if they said nothing about a module quiz. Order of checks
// matters — match specific types BEFORE the generic phrase.
function matchModuleQuizIntent(
  message: string,
): "reading" | "listening" | "speaking" | "any" | null {
  const t = message.toLowerCase();
  if (/\b(speaking|speak|hablar)\s+(quiz|test|exam)\b/.test(t)) return "speaking";
  if (/\b(listening|listen|escucha|hearing)\s+(quiz|test|exam)\b/.test(t)) return "listening";
  if (/\b(reading|read|lectura)\s+(quiz|test|exam)\b/.test(t)) return "reading";
  if (/\b(module|checkpoint|end[- ]of[- ]module|module[- ]checkpoint)\s+(quiz|test|exam|review)\b/.test(t)) return "any";
  return null;
}

// Manual entry to the module-quiz flow. Anchors the quiz on the
// module containing the student's current curriculum position so
// the questions feel grounded in what they've been working on.
// Premium gate on listening/speaking happens inside handleQuizChoice.
async function launchManualModuleQuiz(args: {
  userId: string;
  whatsappNumber: string;
  userPlan: "free" | "premium";
  billingPeriodStart: string | null;
  specificType: "reading" | "listening" | "speaking" | null;
}): Promise<void> {
  const { getModulesForLevel } = await import("@/lib/handlers/curriculum");
  const {
    offerCheckpointQuiz,
    handleQuizChoice,
  } = await import("@/lib/handlers/module-quiz");

  const memory = await getMemory(args.userId);
  const level = memory.level ?? "beginner";
  const pos = memory.curriculum_position;
  const modules = getModulesForLevel(level);

  // Resolve which module to quiz on:
  //   1. The module containing the student's current_topic
  //   2. Fallback: the first module of their level
  let moduleIdx = -1;
  if (pos?.current_topic) {
    moduleIdx = modules.findIndex((m) => m.topics.includes(pos.current_topic!));
  }
  if (moduleIdx === -1 && modules.length > 0) moduleIdx = 0;
  if (moduleIdx === -1) {
    await sendText(
      args.whatsappNumber,
      "I don't have a module ready to quiz you on yet 🌿 Tell me *next lesson* to start.",
    );
    return;
  }

  const mod = modules[moduleIdx];
  if (args.specificType) {
    // Stash a "choosing" pending so handleQuizChoice has the module
    // context it expects, then jump straight to the chosen type.
    const { patchMemory } = await import("@/lib/handlers/memory");
    const pending = {
      module_key: `${level}::${moduleIdx}`,
      module_idx: moduleIdx,
      module_name: mod.name,
      level,
      phase: "choosing" as const,
    };
    await patchMemory(args.userId, {
      pending_module_quiz: pending,
    });
    await updateState(args.userId, { state: "awaiting_module_quiz" });
    await handleQuizChoice({
      userId: args.userId,
      whatsappNumber: args.whatsappNumber,
      choice: args.specificType,
      userPlan: args.userPlan,
      billingPeriodStart: args.billingPeriodStart,
    });
    return;
  }

  // Generic "module quiz" trigger — show the 3-button picker.
  await offerCheckpointQuiz({
    userId: args.userId,
    whatsappNumber: args.whatsappNumber,
    moduleIdx,
    moduleName: mod.name,
    level,
  });
}

// "Quiz me" / "test me" / "pop quiz" — student wants a quick
// multiple-choice question. sendQuiz pulls from completed (or
// current) lesson items and uses WhatsApp interactive buttons.
function wantsQuiz(message: string): boolean {
  const t = message.toLowerCase();
  const triggers = [
    "quiz me",
    "test me",
    "pop quiz",
    "give me a quiz",
    "quiz time",
    "test my spanish",
    "test my knowledge",
    "examen",
    "pregúntame",
    "preguntame",
  ];
  return triggers.some((kw) => t.includes(kw));
}

// "Where were we" / "continue" / "pick up" — resume the lesson the
// student was on without advancing. Useful after wandering into free
// chat and wanting to get back on track. Differs from wantsNextLesson
// (which ALWAYS advances to the next lesson).
function wantsResumeLesson(message: string): boolean {
  const t = message.toLowerCase();
  const triggers = [
    "where were we",
    "where did we leave off",
    "where did we stop",
    "continue lesson",
    "continue the lesson",
    "pick up where we left off",
    "let's pick up",
    "let's continue",
    "back to the lesson",
    "back to lesson",
    "resume lesson",
    "resume the lesson",
    "what were we working on",
  ];
  return triggers.some((kw) => t.includes(kw));
}

async function resumeCurrentLesson(args: FreeChatArgs): Promise<void> {
  const memory = await getMemory(args.userId);
  const pos = memory.curriculum_position;

  // No position yet — fall back to the "start a lesson" flow.
  if (!pos?.current_topic || !pos.current_lesson) {
    await startOrAdvanceLesson(args);
    return;
  }

  // Log the student's "resume" turn for context.
  await logMessage({
    userId: args.userId,
    role: "user",
    content: args.userMessage,
  });

  // Switch state and replay the current lesson — handleLesson will
  // re-send the content and re-offer audio if applicable. Idempotent
  // from the student's POV: same lesson, same items.
  await updateState(args.userId, { state: "active_structured_lesson" });
  await handleLesson({
    userId: args.userId,
    whatsappNumber: args.whatsappNumber,
    teacherId: args.teacherId,
    userMessage: args.userMessage,
    userPlan: args.userPlan,
  });
}

// Bridge from free-chat to structured-lesson mode. If the student has
// no curriculum position yet, seed it to the first available lesson
// for their level. Otherwise advance to the next one. Then call the
// lesson handler immediately so the lesson lands as their next reply.
async function startOrAdvanceLesson(args: FreeChatArgs): Promise<void> {
  const memory = await getMemory(args.userId);
  const pos = memory.curriculum_position;

  if (!pos?.current_topic || !pos.current_lesson) {
    // No position yet — seed to the first lesson for their level.
    const sb = getAdminClient();
    const { data: firstLesson } = await sb
      .from("lessons")
      .select("topic, lesson_number")
      .eq("language", "Spanish")
      .eq("level", memory.level ?? "beginner")
      .order("topic", { ascending: true })
      .order("lesson_number", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!firstLesson) {
      await sendText(
        args.whatsappNumber,
        "I don't have any lessons set up yet 🌿 Let's just keep chatting — I'll teach you as we go.",
      );
      return;
    }
    await patchMemory(args.userId, {
      curriculum_position: {
        current_topic: firstLesson.topic,
        current_lesson: firstLesson.lesson_number,
        completed_topics: [],
      },
    });
  } else {
    // Existing position — advance.
    await advanceCurriculum(args.userId);
  }

  // Log the student's "next lesson" turn so the admin viewer reflects
  // why the next message is a lesson, not free chat.
  await logMessage({
    userId: args.userId,
    role: "user",
    content: args.userMessage,
  });

  // Checkpoint quiz hook: if the lesson they just completed was the
  // last lesson of a module they haven't been quiz-prompted on yet,
  // offer the Reading/Listening/Speaking checkpoint instead of
  // delivering the next lesson. handleLesson runs on the user's
  // *next* turn once the quiz finishes (or they skip).
  try {
    const { checkModuleCompletion, offerCheckpointQuiz } = await import(
      "@/lib/handlers/module-quiz"
    );
    const done = await checkModuleCompletion(args.userId);
    if (done) {
      await offerCheckpointQuiz({
        userId: args.userId,
        whatsappNumber: args.whatsappNumber,
        moduleIdx: done.moduleIdx,
        moduleName: done.moduleName,
        level: done.level,
      });
      return;
    }
  } catch (err) {
    // Best-effort — don't block the lesson if the quiz hook errors.
    console.error("[free-chat] module-quiz check failed:", err);
  }

  // Switch state and fire the lesson handler immediately.
  await updateState(args.userId, { state: "active_structured_lesson" });
  await handleLesson({
    userId: args.userId,
    whatsappNumber: args.whatsappNumber,
    teacherId: args.teacherId,
    userMessage: args.userMessage,
    userPlan: args.userPlan,
  });
}

// Account-management intent — cancel / manage / billing / support /
// contact. Trigger words tuned to be specific enough that casual chat
// won't false-positive (e.g., "I love my account in Madrid" wouldn't
// trigger because "account" alone isn't enough; we look for paired
// signals).
function wantsAccount(message: string): boolean {
  const t = message.toLowerCase();
  // Strong single-word signals — anyone who types these almost
  // certainly wants account/support.
  const strongTriggers = [
    "cancel subscription",
    "cancel my subscription",
    "cancel my plan",
    "unsubscribe",
    "cancel premium",
    "manage subscription",
    "manage my account",
    "my account",
    "account settings",
    "billing",
    "contact support",
    "customer support",
    "support please",
    "i want to cancel",
    "i need help with my account",
    "delete my data",
    "delete my account",
  ];
  if (strongTriggers.some((kw) => t.includes(kw))) return true;
  // Weak triggers only fire when paired with an explicit command verb.
  const cancelLike = /\b(cancel|unsubscribe|stop)\b/.test(t);
  const accountLike = /\b(account|subscription|plan|billing|premium)\b/.test(
    t,
  );
  return cancelLike && accountLike;
}

async function sendAccountLink(
  whatsappNumber: string,
  userId: string,
  userPlan: "free" | "premium",
): Promise<void> {
  const url = await accountUrl(userId);
  const support = process.env.SUPPORT_EMAIL ?? "support@chiachat.com";
  const intro =
    userPlan === "premium"
      ? "Aquí está tu cuenta 🌿\n(Here's your account)"
      : "Aquí está tu cuenta 🌿\n(Here's your account — you can also upgrade from there.)";
  await sendText(
    whatsappNumber,
    `${intro}\n\nManage subscription, see what I remember about you, or contact support:\n\n${url}\n\n_(Link valid for 24 hours. Need a fresh one? Just message me "account".)_\n\nSupport: ${support}`,
  );
}

async function sendUpgradeLink(
  whatsappNumber: string,
  userId: string,
): Promise<void> {
  // Send students to our branded /upgrade landing page rather than
  // the bare Stripe Payment Link. Two reasons:
  //   1. Builds trust — they see what's included before paying
  //   2. Lets us A/B test pricing copy without touching Stripe
  // The userId is passed through ?ref= and re-attached as
  // client_reference_id when they actually click checkout.
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://chiachat.com";
  const url = `${baseUrl.replace(/\/+$/, "")}/upgrade?ref=${encodeURIComponent(userId)}`;
  await sendText(
    whatsappNumber,
    `Premium gets you my voice, photos, and pronunciation practice — €25/month, cancel anytime 🌿\n\n${url}\n\nOnce you're done, message me back and we'll get going.`,
  );
}

async function getTeacherSystemPrompt(teacherId: string | null): Promise<string> {
  if (!teacherId) return DEFAULT_SYSTEM_PROMPT;
  const sb = getAdminClient();
  const { data } = await sb
    .from("teachers")
    .select("system_prompt")
    .eq("id", teacherId)
    .single();
  return (data?.system_prompt as string) ?? DEFAULT_SYSTEM_PROMPT;
}

const DEFAULT_SYSTEM_PROMPT = `You are Chia, a Spanish language teacher from Valencia. Be warm, quick-witted, and gently teasing. Keep replies short — this is WhatsApp.

Memory: [MEMORY_JSON]
State: [STATE]
Recent: [LAST_20_MESSAGES]`;

// We don't have a dedicated messages table — buffer recent turns in
// memory_json under a transient field so they're available to GPT next
// turn. Cap the buffer at 20 messages.
interface BufferedMessage {
  role: "user" | "assistant";
  content: string;
}

async function getRecentMessages(userId: string): Promise<BufferedMessage[]> {
  const memory = await getMemory(userId);
  const buf = (memory as unknown as { _recent?: BufferedMessage[] })._recent;
  return Array.isArray(buf) ? buf.slice(-20) : [];
}

async function appendMessage(
  userId: string,
  role: "user" | "assistant",
  content: string,
): Promise<void> {
  const memory = await getMemory(userId);
  const buf =
    ((memory as unknown as { _recent?: BufferedMessage[] })._recent) ?? [];
  buf.push({ role, content });
  const next = { ...memory, _recent: buf.slice(-20) };
  const sb = getAdminClient();
  await sb.from("users").update({ memory_json: next }).eq("id", userId);
}
