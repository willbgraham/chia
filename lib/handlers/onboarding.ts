// Onboarding state machine: 7 steps from first contact to first interaction.
// Each step parses the user's reply, updates memory + state, and sends the
// next prompt.

import type {
  ConversationStateName,
  Level,
  LessonMode,
  ReminderPreference,
} from "@/types";
import { sendText, sendAudio, sendImage } from "@/lib/messaging/whatsapp";
import { getOrCreateAudio } from "@/lib/messaging/audio-cache";
import { patchMemory, getMemory } from "@/lib/handlers/memory";
import { updateState } from "@/lib/handlers/state";
import { getAdminClient } from "@/lib/supabase/admin";
import { curriculumUrl } from "@/lib/account/magic-link";
import { logMessage } from "@/lib/handlers/messages";

// Logger wrapper that mirrors a Chia outbound to the messages table,
// so admin viewers (and future analytics) can see what an onboarding
// looks like to a real user. The base onboarding handler was sending
// via sendText() only — leaving 8 of 10 recent signups as black boxes
// in the messages table. This thin wrapper plugs the hole.
async function sendAndLog(
  userId: string,
  whatsappNumber: string,
  text: string,
): Promise<void> {
  await sendText(whatsappNumber, text);
  await logMessage({ userId, role: "assistant", content: text });
}

interface OnboardingArgs {
  userId: string;
  whatsappNumber: string;
  step: ConversationStateName;
  userMessage: string;
}

export async function handleOnboarding(args: OnboardingArgs): Promise<void> {
  // Log every inbound user message to the messages table — including
  // the first send from a brand-new user (the ad pre-fill, e.g. "Hi
  // Chia 🌿 I want to learn Spanish"). Without this, 8 of 10 recent
  // signups were opaque in the admin viewer.
  if (args.userMessage) {
    await logMessage({
      userId: args.userId,
      role: "user",
      content: args.userMessage,
    });
  }
  switch (args.step) {
    case "onboarding_step_1":
      return await sendStep1(args);
    case "onboarding_step_2":
      return await processStep2(args);
    case "onboarding_step_3":
    case "onboarding_step_4":
      // Steps 3 and 4 collapsed into one: skip the language ask
      // (we assume English for ad traffic) and go straight to level.
      // Users currently in step_3 (asking language) get the new
      // level prompt on their next reply — minor in-flight blip
      // but no data loss.
      return await processLevelStep(args);
    case "onboarding_step_5":
    case "onboarding_step_6":
    case "onboarding_step_7":
      // Legacy steps from the old 7-step flow. New onboarding skips
      // them entirely — but in-flight users at these states should
      // get gracefully shunted into active free chat rather than
      // being stuck. Set defaults and close out.
      return await finishOnboarding(args);
    default:
      // Unknown onboarding state — reset to step 1.
      await sendStep1(args);
  }
}

// ── Step 1: send the opener ─────────────────────────────────────────────────
// First impression matters. We send a short Spanish voice clip (a "tease"
// of what Premium voice messages feel like — bypasses the audio quota
// since this user is brand-new), then a text that translates what Chia
// just said and chains into the question. Voice + text are intentionally
// linked so the student understands what they just heard.
const VOICE_INTRO_PHRASE =
  "Hola, soy Chia. Bienvenido a ChiaChat. Vamos a aprender español juntos.";

// Two messages go out: voice note + text. Meta doesn't guarantee
// order between two separate API calls, so the copy is written to
// read naturally regardless of which arrives first. References the
// voice note ("that's my actual voice") to make the immersion land,
// shows the method in one line (answers the ad's "show me what you
// can do"), and asks the name in a way that elicits just a name —
// "what should I call you?" rather than "what's your name?" (which
// invites "My name is Sarah" → broke name capture).
const TEXT_AFTER_VOICE = `That's my actual voice up there 🌿 (if you played it!)

Here's how we do this: you just chat with me — about your day, food, travel, anything — and you pick up Spanish the way you would from a friend. No drills, no textbooks. I translate everything so you're never lost.

Para empezar… ¿cómo te llamas? (What should I call you? 😊)`;

// Sent only when the voice intro fails. Opens in Spanish so the
// student still gets a hint of immersion.
const TEXT_FALLBACK_NO_VOICE = `¡Hola! Soy Chia 🌿 — your Spanish friend from Valencia.

Here's how this works: you just chat with me about anything, and you pick up Spanish the way you would from a friend. I translate everything, so you're never lost.

Para empezar… ¿cómo te llamas? (What should I call you? 😊)`;

// Small pause between sends. Meta's media (image/audio) takes time
// to process before delivery to the recipient. Without these pauses,
// text — which has no media to process — overtakes voice/photo in the
// delivery queue. The student then sees the "What's your name?" text
// at the top, with photo/voice arriving below, and has to scroll up
// to read the question. 1.5s is enough for Meta to deliver each
// preceding message in order.
const SEND_GAP_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendStep1(args: OnboardingArgs): Promise<void> {
  // Three messages — photo, voice, text — sent in that order with
  // small gaps so they arrive in order on the student's phone:
  //   [photo]
  //   [voice]
  //   [text: "What's your name?"]   ← most recent, immediately visible
  //
  // Each step is best-effort — failure of one doesn't block the others.

  // 1. Greeting photo (free for everyone — one-time premium teaser).
  await sendGreetingPhoto(args.userId, args.whatsappNumber);
  await sleep(SEND_GAP_MS);

  // 2. Voice intro.
  let voiceSent = false;
  try {
    const { publicUrl } = await getOrCreateAudio(VOICE_INTRO_PHRASE);
    const result = await sendAudio(args.whatsappNumber, publicUrl);
    voiceSent = !result.error;
  } catch (err) {
    console.error("[onboarding] voice intro failed:", err);
  }
  await sleep(SEND_GAP_MS);

  // 3. Text — welcome + first question. This is the message the
  // student needs to respond to, so it must be the LAST one delivered.
  const welcome = voiceSent ? TEXT_AFTER_VOICE : TEXT_FALLBACK_NO_VOICE;
  await sendText(args.whatsappNumber, welcome);
  await logMessage({
    userId: args.userId,
    role: "assistant",
    content: welcome,
  });
  await updateState(args.userId, { state: "onboarding_step_2" });
}

// Pick a teacher_image with context='greeting' for this user's teacher
// and send it. If no greeting image is uploaded (or the user has no
// teacher), skip silently — voice + text still go out, onboarding
// continues. Mid-conversation photos (Phase 2) will reuse the same
// teacher_images table but gate by plan + use a GPT classifier to pick.
async function sendGreetingPhoto(
  userId: string,
  whatsappNumber: string,
): Promise<void> {
  try {
    const sb = getAdminClient();

    // Look up the user's teacher.
    const { data: user } = await sb
      .from("users")
      .select("teacher_id")
      .eq("id", userId)
      .single();
    const teacherId = user?.teacher_id;
    if (!teacherId) return;

    // Pick the most recently uploaded greeting photo. (Could be
    // round-robin / least-recently-sent later; one-shot per user
    // means it doesn't matter much yet.)
    const { data: image } = await sb
      .from("teacher_images")
      .select("storage_url")
      .eq("teacher_id", teacherId)
      .eq("context", "greeting")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!image?.storage_url) return;

    await sendImage(whatsappNumber, image.storage_url);
  } catch (err) {
    console.error("[onboarding] greeting photo failed:", err);
  }
}

// ── Step 2: capture name → ask level (was: ask language) ────────────────────
// Shortened onboarding: skip the language ask (we assume English for
// the dominant ad-driven traffic), set the native_language default,
// and jump straight to the level question. This collapses what was a
// 7-step form into a 3-touch flow (welcome → name → level → go).
async function processStep2(args: OnboardingArgs): Promise<void> {
  const name = await extractName(args.userMessage);
  if (!name) {
    await sendAndLog(
      args.userId,
      args.whatsappNumber,
      "I didn't quite catch your name 🌿 — just your first name is perfect 😊",
    );
    return;
  }
  // Stamp the name + lock in defaults so we don't have to ask. Users
  // can still tweak these later via /account/<token>.
  await patchMemory(args.userId, {
    name,
    native_language: "English",
  });
  await sendAndLog(
    args.userId,
    args.whatsappNumber,
    `Nice to meet you ${name}! 🌿\n\nHow's your Spanish right now? Be honest — I won't judge 😄\n\n1. Complete beginner\n2. I know a little\n3. Intermediate\n4. Advanced`,
  );
  // Jump to step 4 (level parser). Step 3 (language) is skipped.
  await updateState(args.userId, { state: "onboarding_step_4" });
}

// ── Step 4 (level): capture level → finish onboarding ───────────────────────
// Was processStep4 in the old flow. Renamed for clarity since it's
// now the only intermediate step between name capture and going live.
async function processLevelStep(args: OnboardingArgs): Promise<void> {
  const level = parseLevel(args.userMessage);
  if (!level) {
    await sendAndLog(
      args.userId,
      args.whatsappNumber,
      "Pick 1–4 for your level 😊",
    );
    return;
  }
  const memory = await getMemory(args.userId);
  await patchMemory(args.userId, {
    level,
    // Lesson-mode + reminder defaults so we don't need to ask. The
    // student can still trigger a structured lesson with "next lesson"
    // and tweak reminders via /account/<token>.
    lesson_mode: "both",
    reminder_preference: "none",
    curriculum_position: {
      ...(memory.curriculum_position ?? {}),
      current_topic: "greetings",
      current_lesson: 1,
    },
  });
  await finishOnboarding(args);
}

// Closes out onboarding. Sends a warm "you're set" message that
// teaches the two essential commands (`next lesson` for structured,
// chat freely otherwise), flips state to active_free_chat, and
// follows up with the visual curriculum link so it lands in the
// student's WhatsApp Links section.
async function finishOnboarding(args: OnboardingArgs): Promise<void> {
  const memory = await getMemory(args.userId);
  // Fill defaults for any in-flight legacy users who never picked.
  const patches: Record<string, unknown> = {};
  if (!memory.native_language) patches.native_language = "English";
  if (!memory.lesson_mode) patches.lesson_mode = "both";
  if (!memory.reminder_preference) patches.reminder_preference = "none";
  if (Object.keys(patches).length > 0) {
    await patchMemory(args.userId, patches);
  }

  const name = memory.name ?? "amig@";
  await sendAndLog(
    args.userId,
    args.whatsappNumber,
    `¡Perfecto, ${name}! 🌿 We're set up.\n\nTry it: say *next lesson* to start the curriculum, or just chat with me about anything — your day, food, travel, what you want to learn first. ¡Vamos!`,
  );
  await updateState(args.userId, { state: "active_free_chat" });

  // Follow-up: send the curriculum link so it lands in the WhatsApp
  // auto-Links section for this contact. Best-effort.
  await sendCurriculumLinkIntro(args.userId, args.whatsappNumber);
}

// Pull a clean first name out of whatever the student typed. People
// reply in wildly different ways — "Sarah", "My name is Sarah",
// "I'm Jay", "me llamo María", "just call me Jay", or even a whole
// sentence or a non-name like "How does this work?". The old code
// took the literal first word, which stored garbage names like "My"
// (from "My name is…") and "كيف" (Arabic for "how").
//
// GPT is the PRIMARY extractor because it's the only thing that can
// tell "Sarah" (a name) from "How" (not a name) — a regex accepts
// both as "a word of letters". Regex is only the fallback for when
// the GPT call errors out, so onboarding never hard-blocks on an API
// hiccup. One GPT-4o-mini call per new user — negligible cost/latency.
async function extractName(raw: string): Promise<string | null> {
  try {
    const gptName = await extractNameGpt(raw);
    if (gptName) return gptName;
    // GPT explicitly decided there's no name in the message
    // (e.g. "how does this work?") → signal the caller to re-ask.
    return null;
  } catch (err) {
    // GPT unreachable — degrade to regex so onboarding still works.
    console.error("[onboarding] GPT name extraction failed, using regex:", err);
    return extractNameRegex(raw);
  }
}

function extractNameRegex(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  // Strip common conversational lead-ins (English + Spanish).
  s = s.replace(
    /^(my name is|my name'?s|i'?m|i am|call me|you can call me|just call me|it'?s|this is|name'?s|hi,?\s*i'?m|hey,?\s*i'?m|hola,?\s*soy|me llamo|mi nombre es|soy|yo soy)\s+/i,
    "",
  );
  // First remaining token, keep only letters/apostrophes/hyphens
  // (covers accented + non-Latin scripts via \p{L}).
  const first = s.split(/\s+/)[0]?.replace(/[^\p{L}'-]/gu, "") ?? "";
  if (first.length < 2 || first.length > 20) return null;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

async function extractNameGpt(raw: string): Promise<string | null> {
  const { chatCompletion } = await import("@/lib/messaging/openai");
  const system =
    `Extract the person's first name from their message. They were asked "what should I call you?". ` +
    `Return JSON: {"name": "<FirstName>"} with just their name, properly capitalized. ` +
    `If the message contains no actual name (e.g. it's a greeting, a question, or random words), return {"name": null}.`;
  const out = await chatCompletion(
    [
      { role: "system", content: system },
      { role: "user", content: raw.slice(0, 200) },
    ],
    {
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 20,
      response_format: { type: "json_object" },
    },
  );
  const parsed = JSON.parse(out) as { name?: string | null };
  const name = parsed.name?.trim();
  if (!name || name.length < 2 || name.length > 20) return null;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// ── Step 3: native language → ask level ─────────────────────────────────────
async function processStep3(args: OnboardingArgs): Promise<void> {
  const lang = parseLanguage(args.userMessage);
  if (!lang) {
    await sendText(
      args.whatsappNumber,
      "Pick a number 1–5 to choose your home language 😊",
    );
    return;
  }
  if (lang !== "English") {
    // MVP supports English only. Apologise and ask to continue in English.
    await sendText(
      args.whatsappNumber,
      `I'll be honest — for now I'm best at teaching in English. Want to continue in English? Reply "yes" if so, or "1" again to retry.`,
    );
    return;
  }
  await patchMemory(args.userId, { native_language: "English" });
  await sendText(
    args.whatsappNumber,
    "And how's your Spanish right now? Be honest — I won't judge 😄\n\n1. Complete beginner\n2. I know a little\n3. Intermediate\n4. Advanced",
  );
  await updateState(args.userId, { state: "onboarding_step_4" });
}

// ── Step 4: level → ask learning style ──────────────────────────────────────
async function processStep4(args: OnboardingArgs): Promise<void> {
  const level = parseLevel(args.userMessage);
  if (!level) {
    await sendText(args.whatsappNumber, "Pick 1–4 for your level 😊");
    return;
  }
  const memory = await getMemory(args.userId);
  await patchMemory(args.userId, {
    level,
    curriculum_position: {
      ...(memory.curriculum_position ?? {}),
      current_topic: "greetings",
      current_lesson: 1,
    },
  });
  await sendText(
    args.whatsappNumber,
    "How do you want to learn? 🌿\n\n1. Follow a structured lesson plan\n2. Just chat — ask me anything\n3. Both — lessons plus freestyle chat",
  );
  await updateState(args.userId, { state: "onboarding_step_5" });
}

// ── Step 5: learning mode → ask reminders ───────────────────────────────────
async function processStep5(args: OnboardingArgs): Promise<void> {
  const mode = parseLessonMode(args.userMessage);
  if (!mode) {
    await sendText(args.whatsappNumber, "Pick 1, 2, or 3 for how you want to learn 😊");
    return;
  }
  await patchMemory(args.userId, { lesson_mode: mode });
  await sendText(
    args.whatsappNumber,
    "Do you want me to check in on you if you haven't practiced? I get a little worried when I don't hear from you 😊\n\n1. Yes — every day\n2. Yes — every few days\n3. No reminders thanks",
  );
  await updateState(args.userId, { state: "onboarding_step_6" });
}

// ── Step 6: reminders → ask plan ────────────────────────────────────────────
// Two-stage step: first parse the 1/2/3 choice, then if 1 or 2 ask for time.
async function processStep6(args: OnboardingArgs): Promise<void> {
  const memory = await getMemory(args.userId);

  // Sub-stage A: parsing the 1/2/3 choice.
  if (!memory.reminder_preference) {
    const pref = parseReminderPref(args.userMessage);
    if (!pref) {
      await sendText(args.whatsappNumber, "Pick 1, 2, or 3 for reminders 😊");
      return;
    }
    await patchMemoryAndUserCol(args.userId, { reminder_preference: pref });
    if (pref === "none") {
      // Skip the time question, advance straight to plan.
      await sendPlanQuestion(args.whatsappNumber);
      await updateState(args.userId, { state: "onboarding_step_7" });
      return;
    }
    await sendText(
      args.whatsappNumber,
      "What time works best? Just reply with a time like '9am' or '20:00'.",
    );
    return; // stay in step 6, sub-stage B
  }

  // Sub-stage B: parsing the time.
  const time = parseTime(args.userMessage);
  if (!time) {
    await sendText(
      args.whatsappNumber,
      "Hmm — I couldn't read that time. Try '9am', '8pm', or '20:00' 🌿",
    );
    return;
  }
  await patchMemoryAndUserCol(args.userId, { reminder_time: time });
  await sendPlanQuestion(args.whatsappNumber);
  await updateState(args.userId, { state: "onboarding_step_7" });
}

// ── Step 7: plan → first interaction ────────────────────────────────────────
async function processStep7(args: OnboardingArgs): Promise<void> {
  const choice = parsePlanChoice(args.userMessage);
  if (!choice) {
    await sendText(args.whatsappNumber, "Pick 1 or 2 for your plan 😊");
    return;
  }

  if (choice === "premium") {
    await patchMemory(args.userId, { plan: "premium" });
    // Send to the branded /upgrade landing page with userId baked
    // into ?ref so the eventual Stripe checkout carries the right
    // client_reference_id back through the webhook.
    const base =
      process.env.NEXT_PUBLIC_APP_URL ?? "https://chiachat.com";
    const url = `${base.replace(/\/+$/, "")}/upgrade?ref=${encodeURIComponent(args.userId)}`;
    await sendText(
      args.whatsappNumber,
      `Lovely 🌿 Tap here to subscribe — €25/month for voice, photos, and pronunciation: ${url}\n\nOnce you're done, message me back and we'll start.`,
    );
    // Leave state in step 7 until Stripe webhook flips them to premium and
    // a separate reactivation message gets sent.
    return;
  }

  // Free plan → start first interaction.
  await patchMemory(args.userId, { plan: "free" });
  const memory = await getMemory(args.userId);
  if (memory.lesson_mode === "structured" || memory.lesson_mode === "both") {
    await sendText(
      args.whatsappNumber,
      "Perfect 🌿 Your first lesson is greetings — the most important words you'll ever learn in Spanish. Ready?",
    );
    await updateState(args.userId, {
      state: "active_structured_lesson",
    });
  } else {
    await sendText(
      args.whatsappNumber,
      "Perfect 🌿 Ask me anything. How do you say something? What does a word mean? I'm here 😊",
    );
    await updateState(args.userId, { state: "active_free_chat" });
  }

  // Send the visual course-agenda link as a follow-up. The link gets
  // pinned in WhatsApp's auto-Links section for this contact, so even
  // after the magic-link TTL expires, the student can:
  //   1. Always see this message in scrollback
  //   2. Use the keyword Chia teaches them ("course link") to ask
  //      for a fresh one
  // Both branches (structured + free chat) get the same nudge.
  await sendCurriculumLinkIntro(args.userId, args.whatsappNumber);
}

// Sends the visual curriculum link + a one-line note teaching the
// student how to ask for a fresh one anytime. Best-effort — if the
// short-link insert fails for any reason, onboarding still completes.
async function sendCurriculumLinkIntro(
  userId: string,
  whatsappNumber: string,
): Promise<void> {
  try {
    const link = await curriculumUrl(userId);
    await sendText(
      whatsappNumber,
      `One more thing 🌿\n\nHere's your visual course agenda — check off lessons, see what's coming, jump back into any lesson with one tap:\n\n${link}\n\nSave this chat — anytime you want to see your progress, just ask me for the *"course link"* and I'll send you a fresh one.`,
    );
  } catch (err) {
    console.error("[onboarding] sendCurriculumLinkIntro failed:", err);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function sendPlanQuestion(whatsappNumber: string): Promise<void> {
  await sendText(
    whatsappNumber,
    "Last thing — I have a free plan where we can text as much as you want. To hear my voice, see my photos, and practice pronunciation, you'll need Premium 🌿\n\n1. Start free — text only for now\n2. Go Premium — €25/month, hear my voice, see my photos, practice pronunciation",
  );
}

// reminder_preference and reminder_time live in BOTH the user table and
// memory_json (memory is the source of truth GPT reads from; the user
// table column is what the cron scheduler queries by). Keep them in sync.
async function patchMemoryAndUserCol(
  userId: string,
  patch: { reminder_preference?: ReminderPreference; reminder_time?: string },
): Promise<void> {
  const { getAdminClient } = await import("@/lib/supabase/admin");
  const sb = getAdminClient();
  await sb
    .from("users")
    .update({
      ...(patch.reminder_preference !== undefined
        ? { reminder_preference: patch.reminder_preference }
        : {}),
      ...(patch.reminder_time !== undefined
        ? { reminder_time: patch.reminder_time }
        : {}),
    })
    .eq("id", userId);
  await patchMemory(userId, patch);
}

function parseLanguage(msg: string): string | null {
  const t = msg.trim().toLowerCase();
  if (t === "1" || t.startsWith("eng")) return "English";
  if (t === "2" || t.startsWith("fr")) return "French";
  if (t === "3" || t.startsWith("ger") || t.startsWith("deu")) return "German";
  if (t === "4" || t.startsWith("it")) return "Italian";
  if (t === "5" || t.startsWith("oth")) return "Other";
  if (t === "yes") return "English";
  return null;
}

function parseLevel(msg: string): Level | null {
  const t = msg.trim().toLowerCase();
  if (t === "1" || t === "2" || t.includes("beginner") || t.includes("little"))
    return "beginner";
  if (t === "3" || t.includes("intermediate")) return "intermediate";
  if (t === "4" || t.includes("advanced")) return "advanced";
  return null;
}

function parseLessonMode(msg: string): LessonMode | null {
  const t = msg.trim().toLowerCase();
  if (t === "1" || t.includes("structured") || t.includes("plan"))
    return "structured";
  if (t === "2" || t.includes("chat") || t.includes("free")) return "free";
  if (t === "3" || t.includes("both")) return "both";
  return null;
}

function parseReminderPref(msg: string): ReminderPreference | null {
  const t = msg.trim().toLowerCase();
  if (t === "1" || t.includes("daily") || t.includes("every day")) return "daily";
  if (t === "2" || t.includes("few")) return "few_days";
  if (t === "3" || t.includes("no")) return "none";
  return null;
}

function parseTime(msg: string): string | null {
  // Accept "9am", "9 am", "20:00", "8:30pm", etc. Returns 24h "HH:mm".
  const t = msg.trim().toLowerCase();
  const ampm = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const m = ampm[2] ? parseInt(ampm[2], 10) : 0;
    if (ampm[3] === "pm" && h < 12) h += 12;
    if (ampm[3] === "am" && h === 12) h = 0;
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  const h24 = t.match(/^(\d{1,2}):(\d{2})$/);
  if (h24) {
    const h = parseInt(h24[1], 10);
    const m = parseInt(h24[2], 10);
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  return null;
}

function parsePlanChoice(msg: string): "free" | "premium" | null {
  const t = msg.trim().toLowerCase();
  if (t === "1" || t.includes("free") || t.includes("text")) return "free";
  if (t === "2" || t.includes("premium") || t.includes("pay")) return "premium";
  return null;
}
