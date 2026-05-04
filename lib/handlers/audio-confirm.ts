// Audio-confirm handler: user replied yes/no to "want to hear me say it?".
// On yes: meter usage, generate audio (cache-aware), send to user, switch
// state to awaiting_voice_note. On no: text reply and back to free chat.

import { sendText, sendAudio } from "@/lib/messaging/whatsapp";
import { getOrCreateAudio } from "@/lib/messaging/audio-cache";
import { getAdminClient } from "@/lib/supabase/admin";
import { updateState } from "@/lib/handlers/state";
import { logAudioUsage, isWithinLimit } from "@/lib/handlers/usage";
import type { Plan } from "@/types";

interface AudioConfirmArgs {
  userId: string;
  whatsappNumber: string;
  pendingPhrase: string | null;
  userPlan: Plan;
  billingPeriodStart: string | null;
  userMessage: string;
}

export async function handleAudioConfirm(args: AudioConfirmArgs): Promise<void> {
  const yes = parseYes(args.userMessage);

  if (!yes) {
    await sendText(
      args.whatsappNumber,
      "No worries 🌿 we'll keep texting. What else?",
    );
    await updateState(args.userId, {
      state: "active_free_chat",
      pending_phrase: null,
    });
    return;
  }

  if (!args.pendingPhrase) {
    await sendText(
      args.whatsappNumber,
      "Hmm — I lost track of what I was about to say. Ask me again?",
    );
    await updateState(args.userId, { state: "active_free_chat" });
    return;
  }

  // Free plan: no audio.
  if (args.userPlan === "free") {
    await sendText(
      args.whatsappNumber,
      "Voice messages are part of Premium 🌿 — text-only on free. Upgrade and you can hear me anytime.",
    );
    await updateState(args.userId, {
      state: "active_free_chat",
      pending_phrase: null,
    });
    return;
  }

  // Quota check.
  const limit = await isWithinLimit(
    args.userId,
    args.userPlan,
    args.billingPeriodStart,
    args.pendingPhrase.length,
  );
  if (!limit.ok) {
    // Premium audio quota exhausted for the period. Point them at
    // the branded /upgrade page (mostly billing info / cancel
    // self-service) rather than a bare Stripe link.
    const base =
      process.env.NEXT_PUBLIC_APP_URL ?? "https://chiachat.com";
    const upgradeUrl = `${base.replace(/\/+$/, "")}/upgrade?ref=${encodeURIComponent(args.userId)}`;
    await sendText(
      args.whatsappNumber,
      `We've hit your voice limit for the month — text continues 😊 ${upgradeUrl}`,
    );
    await updateState(args.userId, {
      state: "active_free_chat",
      pending_phrase: null,
    });
    return;
  }

  // Generate (or cache-hit) the audio.
  const { publicUrl, fromCache, charactersGenerated } = await getOrCreateAudio(
    args.pendingPhrase,
  );

  // Send the audio message.
  const sendResult = await sendAudio(args.whatsappNumber, publicUrl);
  if (sendResult.error) {
    await sendText(
      args.whatsappNumber,
      "I tried to send you the audio but something went wrong on my end 🌿 Try asking again?",
    );
    return;
  }

  // Log usage (only count what we actually generated, not cache hits).
  await logAudioUsage({
    user_id: args.userId,
    characters_used: fromCache ? 0 : charactersGenerated,
    source: "make_tts",
    direction: "outbound",
  });

  // Threshold warnings — soft mention at 80%, harder at 95%.
  if (limit.used + charactersGenerated > limit.limit * 0.95) {
    await sendText(
      args.whatsappNumber,
      "We have maybe 2–3 voice messages left this month before I go quiet... or you could upgrade and we keep talking as much as you want 😊",
    );
  } else if (limit.used + charactersGenerated > limit.limit * 0.8) {
    await sendText(
      args.whatsappNumber,
      "A propósito — we've been talking a lot this month which I love 🥰 Just so you know, we're getting close to your voice limit.",
    );
  }

  // Prompt voice-note practice.
  await sendText(
    args.whatsappNumber,
    "Now want to try saying it back to me? 🎵 Just send a voice note.",
  );
  await updateState(args.userId, {
    state: "awaiting_voice_note",
    pending_audio_url: publicUrl,
  });
  // Note: incoming voice note will land at /api/webhooks/whatsapp as type=audio.
  // Voice-note handling is in lib/handlers/voice-note.ts.
  void getAdminClient; // avoid unused-import lint
}

function parseYes(msg: string): boolean {
  const t = msg.trim().toLowerCase();
  return (
    t === "yes" ||
    t === "y" ||
    t === "sí" ||
    t === "si" ||
    t === "ok" ||
    t === "okay" ||
    t === "sure" ||
    t === "please" ||
    t === "yeah" ||
    t === "yep" ||
    t.includes("🎵") ||
    t.startsWith("yes")
  );
}
