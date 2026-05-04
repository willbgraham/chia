// Free-chat handler: build the GPT prompt with Chia's system prompt + memory
// + recent messages, send the response. If the response offers audio, store
// the target phrase in pending_phrase and switch state.

import { sendText } from "@/lib/messaging/whatsapp";
import { chiaTextTurn, chatCompletion } from "@/lib/messaging/openai";
import { getAdminClient } from "@/lib/supabase/admin";
import { getMemory } from "@/lib/handlers/memory";
import { updateState } from "@/lib/handlers/state";

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

  const reply = await chiaTextTurn({
    systemPromptTemplate: systemPrompt,
    memoryJson: memory,
    state: "active_free_chat",
    recentMessages: recent,
    userMessage: args.userMessage,
    userPlan: args.userPlan,
  });

  await sendText(args.whatsappNumber, reply);
  await appendMessage(args.userId, "user", args.userMessage);
  await appendMessage(args.userId, "assistant", reply);

  // Detect upgrade intent — if the student is on free and asks to
  // upgrade, send them the Stripe payment link as a follow-up message.
  if (args.userPlan === "free" && wantsUpgrade(args.userMessage)) {
    await sendUpgradeLink(args.whatsappNumber, args.userId);
  }

  // Always run the phrase extractor — it returns null if Chia didn't
  // actually offer audio. Cheaper than maintaining a phrasing heuristic
  // that misses turns of phrase the model uses.
  const phrase = await extractTargetPhrase(reply);
  if (phrase) {
    await updateState(args.userId, {
      state: "awaiting_audio_confirm",
      pending_phrase: phrase,
    });
  }
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
