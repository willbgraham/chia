// Voice-note handler — pronunciation correction loop.
//
// 1. Download the audio from Meta's media URL
// 2. Transcribe via OpenAI Whisper
// 3. Compare transcription to pending_phrase via GPT (Chia's voice)
// 4. Send Chia's correction text via WhatsApp
// 5. Generate corrective TTS audio via ElevenLabs and send (if premium + within quota)
// 6. Reset state to active_*

import {
  sendText,
  sendAudio,
  fetchMediaUrl,
  downloadMedia,
} from "@/lib/messaging/whatsapp";
import { transcribeAudio, analysePronunciation } from "@/lib/messaging/openai";
import { getOrCreateAudio } from "@/lib/messaging/audio-cache";
import { getAdminClient } from "@/lib/supabase/admin";
import { getMemory, patchMemory } from "@/lib/handlers/memory";
import { updateState } from "@/lib/handlers/state";
import { logAudioUsage, isWithinLimit } from "@/lib/handlers/usage";
import { logMessage } from "@/lib/handlers/messages";
import type { ConversationStateName, MemoryJson, Plan } from "@/types";

interface VoiceNoteArgs {
  userId: string;
  whatsappNumber: string;
  currentState: ConversationStateName;
  pendingPhrase: string | null;
  audioMediaId: string;
  userPlan: Plan;
  billingPeriodStart: string | null;
  teacherId: string | null;
}

export async function handleVoiceNote(args: VoiceNoteArgs): Promise<void> {
  if (args.currentState !== "awaiting_voice_note") {
    await sendText(
      args.whatsappNumber,
      "I got your voice note 🌿 For now I'm best with text — ask me anything you want to learn?",
    );
    return;
  }
  if (!args.pendingPhrase) {
    await sendText(
      args.whatsappNumber,
      "I lost track of what we were practicing 🌿 Ask me to repeat?",
    );
    await updateState(args.userId, {
      state: "active_free_chat",
      pending_phrase: null,
    });
    return;
  }

  const memory = await getMemory(args.userId);

  // 1. Download the audio from Meta.
  const mediaUrl = await fetchMediaUrl(args.audioMediaId);
  if (!mediaUrl) {
    await sendText(
      args.whatsappNumber,
      "Couldn't grab your voice note from WhatsApp — try sending it again?",
    );
    return;
  }
  const audio = await downloadMedia(mediaUrl);

  // 2. Transcribe via Whisper.
  let transcription: string;
  try {
    transcription = await transcribeAudio(audio, { language: "es" });
  } catch (err) {
    console.error("[voice-note] transcription failed:", err);
    await sendText(
      args.whatsappNumber,
      "I couldn't quite hear that 🌿 Try recording again somewhere quieter?",
    );
    return;
  }

  // 3. Pronunciation analysis via Chia's voice prompt.
  const agentVoicePrompt = await getAgentVoicePrompt(args.teacherId);
  let correctionText: string;
  try {
    correctionText = await analysePronunciation({
      targetPhrase: args.pendingPhrase,
      transcription,
      studentName: memory.name ?? null,
      agentVoicePrompt,
    });
  } catch (err) {
    console.error("[voice-note] analysis failed:", err);
    await sendText(
      args.whatsappNumber,
      "I heard you say something but I'm having a brain fog moment 🌿 Try once more?",
    );
    return;
  }

  // 4. Send Chia's correction text + log both inbound + outbound.
  await sendText(args.whatsappNumber, correctionText);
  await logMessage({
    userId: args.userId,
    role: "user",
    content: `[voice note: "${transcription.trim()}"]`,
  });
  await logMessage({
    userId: args.userId,
    role: "assistant",
    content: correctionText,
  });

  // 5. Optional: corrective audio clip (only premium + within quota).
  await maybeSendCorrectiveAudio({
    userId: args.userId,
    whatsappNumber: args.whatsappNumber,
    targetPhrase: args.pendingPhrase,
    userPlan: args.userPlan,
    billingPeriodStart: args.billingPeriodStart,
  });

  // 6. Update memory with the pronunciation note + flip state back to active.
  const newNotes = [
    ...((memory.language_progress?.pronunciation_notes ?? []) as string[]),
    `[${new Date().toISOString().slice(0, 10)}] said "${transcription.trim()}" attempting "${args.pendingPhrase}"`,
  ].slice(-50);
  await patchMemory(args.userId, {
    language_progress: {
      ...(memory.language_progress ?? {}),
      pronunciation_notes: newNotes,
    },
  } as Partial<MemoryJson>);

  // After a voice-note exchange, drop into free chat so follow-ups
  // ("can you say it slower?", "what does that mean again?") get handled
  // conversationally instead of re-triggering the lesson handler.
  // Re-entering structured lesson mode is a separate, explicit user action
  // (asking "next lesson" or similar — handled via free-chat for now).
  await updateState(args.userId, {
    state: "active_free_chat",
    pending_phrase: null,
    pending_audio_url: null,
  });
}

// ── Internals ──────────────────────────────────────────────────────────────

async function maybeSendCorrectiveAudio(args: {
  userId: string;
  whatsappNumber: string;
  targetPhrase: string;
  userPlan: Plan;
  billingPeriodStart: string | null;
}): Promise<void> {
  if (args.userPlan !== "premium") return;

  const limit = await isWithinLimit(
    args.userId,
    args.userPlan,
    args.billingPeriodStart,
    args.targetPhrase.length,
  );
  if (!limit.ok) return; // user already hit the cap; correction text alone is fine

  try {
    const { publicUrl, fromCache, charactersGenerated } = await getOrCreateAudio(
      args.targetPhrase,
    );
    await sendAudio(args.whatsappNumber, publicUrl);
    await logAudioUsage({
      user_id: args.userId,
      characters_used: fromCache ? 0 : charactersGenerated,
      source: "make_tts",
      direction: "outbound",
    });
  } catch (err) {
    // Don't fail the whole voice-note flow if the corrective clip can't be sent.
    console.error("[voice-note] corrective audio failed:", err);
  }
}

async function getAgentVoicePrompt(
  teacherId: string | null,
): Promise<string> {
  if (!teacherId) return DEFAULT_AGENT_PROMPT;
  const sb = getAdminClient();
  const { data } = await sb
    .from("teachers")
    .select("agent_voice_prompt")
    .eq("id", teacherId)
    .single();
  return (data?.agent_voice_prompt as string) ?? DEFAULT_AGENT_PROMPT;
}

const DEFAULT_AGENT_PROMPT = `You are Chia, a warm Spanish language teacher from Valencia. The student just sent you a voice note attempting to pronounce a Spanish phrase. Listen, identify the ONE most important pronunciation issue, and respond warmly and specifically in 1–2 sentences. Then encourage them. Be brief — this is over WhatsApp. Speak in English with the occasional Spanish word.

Target phrase the student was attempting: [PENDING_PHRASE]
Student name: [STUDENT_NAME]`;
