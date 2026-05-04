// Free-chat handler: build the GPT prompt with Chia's system prompt + memory
// + recent messages, send the response. If the response offers audio, store
// the target phrase in pending_phrase and switch state.

import { sendText, sendImage } from "@/lib/messaging/whatsapp";
import { chiaTextTurn, chatCompletion } from "@/lib/messaging/openai";
import { getAdminClient } from "@/lib/supabase/admin";
import { getMemory } from "@/lib/handlers/memory";
import { updateState } from "@/lib/handlers/state";
import { accountUrl } from "@/lib/account/magic-link";
import { pickContextualPhoto } from "@/lib/handlers/photo-pick";
import { logMessage } from "@/lib/handlers/messages";

interface FreeChatArgs {
  userId: string;
  whatsappNumber: string;
  teacherId: string | null;
  userPlan: "free" | "premium";
  userMessage: string;
}

export async function handleFreeChat(args: FreeChatArgs): Promise<void> {
  const memory = await getMemory(args.userId);

  const systemPrompt = await getTeacherSystemPrompt(args.teacherId);
  const recent = await getRecentMessages(args.userId);

  const rawReply = await chiaTextTurn({
    systemPromptTemplate: systemPrompt,
    memoryJson: memory,
    state: "active_free_chat",
    recentMessages: recent,
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
  const url = accountUrl(userId);
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
  const link = process.env.STRIPE_PREMIUM_PAYMENT_LINK;
  if (!link) {
    await sendText(
      whatsappNumber,
      "Premium isn't quite set up on my side yet 🌿 — give me a minute and try again?",
    );
    return;
  }
  // Use user.id (UUID) as client_reference_id — URL-safe and won't get
  // mangled like the phone number (+ → %2B). The Stripe webhook looks
  // up by id to flip the user to premium.
  const url = `${link}${link.includes("?") ? "&" : "?"}client_reference_id=${userId}`;
  await sendText(
    whatsappNumber,
    `Premium gets you my voice and pronunciation practice — €25/month, cancel anytime 🌿\n\n${url}\n\nOnce you're done, message me back and we'll get going.`,
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
