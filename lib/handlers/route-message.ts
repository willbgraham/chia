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
  type: "text" | "audio" | "image" | "other";
  textBody?: string;
  audioMediaId?: string;
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

  // 3. Route by message type + state.
  if (msg.type === "audio") {
    if (!msg.audioMediaId) return;
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
      });
      return;

    case "active_structured_lesson":
      await handleLesson({
        userId: user.id,
        whatsappNumber: msg.whatsappNumber,
        teacherId: user.teacher_id,
        userMessage: msg.textBody,
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
