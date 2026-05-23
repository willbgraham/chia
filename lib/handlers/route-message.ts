// Top-level inbound message router. Replaces what was Make Scenario 1.
// Webhook handler at /api/webhooks/whatsapp parses the Meta payload and
// hands the relevant fields to handleInbound() below.

import { getAdminClient } from "@/lib/supabase/admin";
import { sendText } from "@/lib/messaging/whatsapp";
import { handleOnboarding } from "@/lib/handlers/onboarding";
import { handleFreeChat } from "@/lib/handlers/free-chat";
import { handleLesson } from "@/lib/handlers/lesson";
import { handleAudioConfirm } from "@/lib/handlers/audio-confirm";
import { handleVoiceNote } from "@/lib/handlers/voice-note";
import { handleQuizAnswer } from "@/lib/handlers/quiz";
import {
  handleQuizAnswer as handleModuleQuizAnswer,
  handleQuizChoice as handleModuleQuizChoice,
  handleQuizVoice as handleModuleQuizVoice,
  parseChoiceFromButtonId as parseModuleQuizChoice,
  parseChoiceText as parseModuleQuizChoiceText,
} from "@/lib/handlers/module-quiz";
import {
  handlePracticeResponse as handleLessonPracticeResponse,
  handleLessonQuizAnswer,
  handleLessonQuizVoice,
  matchQuitIntent as matchLessonQuitIntent,
  handleQuitIntent as handleLessonQuitIntent,
  clearStaleLessonState,
} from "@/lib/handlers/lesson-quiz";
import {
  getOrCreateState,
  touchLastMessage,
  updateState as updateStateInline,
} from "@/lib/handlers/state";
import { checkAndIncrementDailyTextCount } from "@/lib/handlers/usage";
import type { User, ConversationStateName } from "@/types";

// Shape of the parsed inbound message we pass between handlers.
export interface InboundMessage {
  whatsappNumber: string;       // E.164 with leading + (we add it on parse)
  type: "text" | "audio" | "image" | "button_reply" | "other";
  textBody?: string;
  audioMediaId?: string;
  // For interactive button taps (pop-quiz answers, etc.):
  buttonReplyId?: string;
  buttonReplyTitle?: string;
}

export async function handleInbound(msg: InboundMessage): Promise<void> {
  const sb = getAdminClient();

  // 1. Look up or create the user.
  let user = await findUser(msg.whatsappNumber);
  if (!user) {
    user = await createNewUser(msg.whatsappNumber);
    // Create the conversation_state row immediately so subsequent
    // updateState() calls inside handleOnboarding find a row to update.
    await getOrCreateState(user.id);
    // For brand-new users, force them to onboarding step 1 regardless of
    // what type of message came in.
    await handleOnboarding({
      userId: user.id,
      whatsappNumber: msg.whatsappNumber,
      step: "onboarding_step_1",
      userMessage: msg.textBody ?? "",
    });
    return;
  }

  // 2. Get or create their conversation_state row.
  const state = await getOrCreateState(user.id);
  await touchLastMessage(user.id);

  // 2b. Stale-state recovery for the lesson practice/quiz loop. If
  // the student bailed mid-lesson 24h+ ago and now returns, don't
  // trap them in the old state — clear it and let them re-enter the
  // normal flow. lesson-quiz.clearStaleLessonState handles the
  // user-facing soft message + state reset; we then fall through
  // and route the current message as if state were active_free_chat.
  if (
    (state.state === "awaiting_lesson_practice" ||
      state.state === "awaiting_lesson_quiz") &&
    state.last_message_at &&
    Date.now() - new Date(state.last_message_at).getTime() >
      24 * 60 * 60 * 1000
  ) {
    await clearStaleLessonState(user.id, msg.whatsappNumber);
    state.state = "active_free_chat";
  }

  // 3. Route by message type + state.
  // Button replies from interactive messages (currently used by
  // pop-quiz answers) take priority over text routing — they only
  // make sense in the awaiting_quiz_answer state.
  if (msg.type === "button_reply") {
    if (state.state === "awaiting_quiz_answer") {
      await handleQuizAnswer({
        userId: user.id,
        whatsappNumber: msg.whatsappNumber,
        buttonReplyId: msg.buttonReplyId ?? null,
        buttonReplyTitle: msg.buttonReplyTitle ?? null,
        userPlan: user.plan,
        teacherId: user.teacher_id,
      });
    } else if (state.state === "awaiting_module_quiz") {
      // Two possibilities: they tapped Reading/Listening/Speaking
      // (mq_* ids = choice phase) or they tapped an answer option
      // (anything else = running phase).
      const choice = parseModuleQuizChoice(msg.buttonReplyId);
      if (choice) {
        await handleModuleQuizChoice({
          userId: user.id,
          whatsappNumber: msg.whatsappNumber,
          choice,
          userPlan: user.plan,
          billingPeriodStart: user.billing_period_start,
        });
      } else {
        await handleModuleQuizAnswer({
          userId: user.id,
          whatsappNumber: msg.whatsappNumber,
          buttonReplyId: msg.buttonReplyId ?? null,
          textFallback: null,
          userPlan: user.plan,
          billingPeriodStart: user.billing_period_start,
        });
      }
    } else if (state.state === "awaiting_lesson_quiz") {
      // Lesson-quiz MCQ answer (covers both button-reply and
      // collapsed-list-reply ids — the webhook parser folds list_reply
      // into the same shape).
      await handleLessonQuizAnswer({
        userId: user.id,
        whatsappNumber: msg.whatsappNumber,
        buttonReplyId: msg.buttonReplyId ?? null,
        textFallback: null,
        userPlan: user.plan,
        teacherId: user.teacher_id,
      });
    } else {
      // Stray button reply (state cleared in another tab, expired
      // quiz, etc.) — soft acknowledge and reset.
      await sendText(
        msg.whatsappNumber,
        "Hmm, that quiz isn't open anymore 🌿 Tell me *quiz me* if you want a fresh one.",
      );
      await updateStateInline(user.id, {
        state: "active_free_chat",
        pending_phrase: null,
      });
    }
    return;
  }

  if (msg.type === "audio") {
    if (!msg.audioMediaId) return;
    // Speaking-quiz voice notes are routed to their owning handler
    // (module-quiz or lesson-quiz); everything else flows through
    // the normal voice-note pipeline.
    if (state.state === "awaiting_module_quiz") {
      await handleModuleQuizVoice({
        userId: user.id,
        whatsappNumber: msg.whatsappNumber,
        audioMediaId: msg.audioMediaId,
        userPlan: user.plan,
        billingPeriodStart: user.billing_period_start,
      });
      return;
    }
    if (state.state === "awaiting_lesson_quiz") {
      await handleLessonQuizVoice({
        userId: user.id,
        whatsappNumber: msg.whatsappNumber,
        audioMediaId: msg.audioMediaId,
        userPlan: user.plan,
        teacherId: user.teacher_id,
      });
      return;
    }
    await handleVoiceNote({
      userId: user.id,
      whatsappNumber: msg.whatsappNumber,
      currentState: state.state,
      pendingPhrase: state.pending_phrase,
      audioMediaId: msg.audioMediaId,
      userPlan: user.plan,
      billingPeriodStart: user.billing_period_start,
      teacherId: user.teacher_id,
    });
    return;
  }

  if (msg.type !== "text" || !msg.textBody) {
    // Image/sticker/etc. — gentle redirect.
    await sendText(
      msg.whatsappNumber,
      "I work best with text and voice notes 🌿 What would you like to learn?",
    );
    return;
  }

  // Daily text-message throttle. Bounds OpenAI spend per user — free
  // = FREE_DAILY_TEXT_LIMIT (default 50), premium = PREMIUM_DAILY_TEXT_LIMIT
  // (default 500 soft cap). Onboarding is exempt so a new student can
  // always finish setup; once they hit free chat, every text counts.
  const isOnboarding = state.state.startsWith("onboarding_step_");
  if (!isOnboarding) {
    const throttle = await checkAndIncrementDailyTextCount(user.id, user.plan);
    if (!throttle.allowed) {
      await sendDailyCapMessage(msg.whatsappNumber, user.plan, user.id);
      return;
    }
  }

  // Text routing:
  switch (state.state) {
    case "onboarding_step_1":
    case "onboarding_step_2":
    case "onboarding_step_3":
    case "onboarding_step_4":
    case "onboarding_step_5":
    case "onboarding_step_6":
    case "onboarding_step_7":
      await handleOnboarding({
        userId: user.id,
        whatsappNumber: msg.whatsappNumber,
        step: state.state,
        userMessage: msg.textBody,
      });
      return;

    case "active_free_chat":
    case "idle":
      await handleFreeChat({
        userId: user.id,
        whatsappNumber: msg.whatsappNumber,
        teacherId: user.teacher_id,
        userPlan: user.plan,
        userMessage: msg.textBody,
        billingPeriodStart: user.billing_period_start,
      });
      return;

    case "active_structured_lesson":
      await handleLesson({
        userId: user.id,
        whatsappNumber: msg.whatsappNumber,
        teacherId: user.teacher_id,
        userMessage: msg.textBody,
        userPlan: user.plan,
      });
      return;

    case "awaiting_audio_confirm":
      await handleAudioConfirm({
        userId: user.id,
        whatsappNumber: msg.whatsappNumber,
        pendingPhrase: state.pending_phrase,
        userPlan: user.plan,
        billingPeriodStart: user.billing_period_start,
        userMessage: msg.textBody,
        teacherId: user.teacher_id,
      });
      return;

    case "awaiting_quiz_answer":
      // Text fallback if the interactive message couldn't be delivered
      // (some WhatsApp clients on older devices). Treat "1"/"2"/"3"
      // as picking option 1/2/3 in the stored quiz.
      await handleQuizAnswer({
        userId: user.id,
        whatsappNumber: msg.whatsappNumber,
        buttonReplyId: null,
        buttonReplyTitle: null,
        textFallback: msg.textBody,
        userPlan: user.plan,
        teacherId: user.teacher_id,
      });
      return;

    case "awaiting_module_quiz":
      // Text fallback for module quiz. During the "choosing" phase
      // a text reply might be "reading" / "skip"; during the
      // "running" phase it might be "1"/"2"/"3" answering an MCQ.
      // The handler infers from memory.pending_module_quiz.phase.
      {
        const choice = parseModuleQuizChoiceText(msg.textBody);
        if (choice) {
          await handleModuleQuizChoice({
            userId: user.id,
            whatsappNumber: msg.whatsappNumber,
            choice,
            userPlan: user.plan,
            billingPeriodStart: user.billing_period_start,
          });
        } else {
          await handleModuleQuizAnswer({
            userId: user.id,
            whatsappNumber: msg.whatsappNumber,
            buttonReplyId: null,
            textFallback: msg.textBody,
            userPlan: user.plan,
            billingPeriodStart: user.billing_period_start,
          });
        }
      }
      return;

    case "awaiting_lesson_practice":
      // Guided practice: student typed (or voice-noted) their response.
      // Quit-intent check first so "skip" cleanly exits the loop.
      if (matchLessonQuitIntent(msg.textBody)) {
        await handleLessonQuitIntent(user.id, msg.whatsappNumber);
        return;
      }
      await handleLessonPracticeResponse({
        userId: user.id,
        whatsappNumber: msg.whatsappNumber,
        userMessage: msg.textBody,
        teacherId: user.teacher_id,
        userPlan: user.plan,
      });
      return;

    case "awaiting_lesson_quiz":
      // Text fallback for lesson quiz (or quit intent). The handler
      // checks for quit-intent internally before fallback grading.
      await handleLessonQuizAnswer({
        userId: user.id,
        whatsappNumber: msg.whatsappNumber,
        buttonReplyId: null,
        textFallback: msg.textBody,
        userPlan: user.plan,
        teacherId: user.teacher_id,
      });
      return;

    case "awaiting_voice_note":
      // Student sent text instead of a voice note. Drop the preamble —
      // it was firing on every text turn while stuck in this state.
      // Just reset to free chat and let Chia answer normally.
      await updateStateInline(user.id, {
        state: "active_free_chat",
        pending_phrase: null,
        pending_audio_url: null,
      });
      await handleFreeChat({
        userId: user.id,
        whatsappNumber: msg.whatsappNumber,
        teacherId: user.teacher_id,
        userPlan: user.plan,
        userMessage: msg.textBody,
        billingPeriodStart: user.billing_period_start,
      });
      return;

    default:
      // Unknown state — recover by sending to free chat.
      await handleFreeChat({
        userId: user.id,
        whatsappNumber: msg.whatsappNumber,
        teacherId: user.teacher_id,
        userPlan: user.plan,
        userMessage: msg.textBody,
        billingPeriodStart: user.billing_period_start,
      });
  }

  // Avoid unused-symbol lint for sb; we may use it for future state writes.
  void sb;
  void (state.state as ConversationStateName);
}

// ── Internals ──────────────────────────────────────────────────────────────

async function findUser(whatsappNumber: string): Promise<User | null> {
  const sb = getAdminClient();
  const { data } = await sb
    .from("users")
    .select("*")
    .eq("whatsapp_number", whatsappNumber)
    .maybeSingle();
  return (data as User | null) ?? null;
}

async function sendDailyCapMessage(
  whatsappNumber: string,
  plan: User["plan"],
  userId: string,
): Promise<void> {
  if (plan === "premium") {
    // Soft cap — friendly notice, no upgrade pitch (they already paid).
    await sendText(
      whatsappNumber,
      "Hemos hablado mucho hoy 🌿 (We've talked a lot today!) Let's pick this back up tomorrow — descansa un poco. Hablamos mañana.",
    );
    return;
  }
  const link = process.env.STRIPE_PREMIUM_PAYMENT_LINK;
  const upgradeLine = link
    ? `\n\nIf you'd like to keep going today, Premium unlocks more chat + my voice — €25/month, cancel anytime:\n${link}${link.includes("?") ? "&" : "?"}client_reference_id=${userId}`
    : "";
  await sendText(
    whatsappNumber,
    `Hemos hablado mucho hoy 🌿 (We've talked a lot today!) The free plan is capped daily so we both stay sane. Let's continue tomorrow — hablamos mañana.${upgradeLine}`,
  );
}

async function createNewUser(whatsappNumber: string): Promise<User> {
  const sb = getAdminClient();

  // Find the active default teacher (Chia, in MVP).
  const { data: teacher } = await sb
    .from("teachers")
    .select("id")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  const { data, error } = await sb
    .from("users")
    .insert({
      whatsapp_number: whatsappNumber,
      teacher_id: teacher?.id ?? null,
      plan: "free",
      memory_json: {},
    })
    .select("*")
    .single();
  if (error) throw new Error(`createNewUser: ${error.message}`);
  return data as User;
}
