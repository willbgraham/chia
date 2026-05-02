// Voice-note handler: user sent an audio message. Two paths:
//   - state = awaiting_voice_note: hand off to ElevenLabs Conversational
//     Agent for pronunciation correction.
//   - any other state: gentle "I work best with text" reply.

import {
  sendText,
  fetchMediaUrl,
  downloadMedia,
} from "@/lib/messaging/whatsapp";
import { invokeAgent } from "@/lib/messaging/elevenlabs";
import { getMemory } from "@/lib/handlers/memory";
import { updateState } from "@/lib/handlers/state";
import type { ConversationStateName } from "@/types";

interface VoiceNoteArgs {
  userId: string;
  whatsappNumber: string;
  currentState: ConversationStateName;
  pendingPhrase: string | null;
  audioMediaId: string;
}

export async function handleVoiceNote(args: VoiceNoteArgs): Promise<void> {
  if (args.currentState !== "awaiting_voice_note") {
    await sendText(
      args.whatsappNumber,
      "I got your voice note 🌿 For now I'm best with text — ask me anything you want to learn?",
    );
    return;
  }

  const memory = await getMemory(args.userId);

  // Resolve and download the audio. The agent will receive it for STT.
  const mediaUrl = await fetchMediaUrl(args.audioMediaId);
  if (!mediaUrl) {
    await sendText(
      args.whatsappNumber,
      "I couldn't get your voice note 😞 — try sending it again?",
    );
    return;
  }
  const audio = await downloadMedia(mediaUrl);

  // Hand off to the ElevenLabs Conversational Agent. The agent's post-call
  // webhook will fire to /api/webhooks/elevenlabs and that handler resets
  // conversation_state back to active_*.
  const result = await invokeAgent({
    audio,
    whatsappNumber: args.whatsappNumber,
    pendingPhrase: args.pendingPhrase,
    studentName: memory.name ?? null,
  });

  if (result.error) {
    await sendText(
      args.whatsappNumber,
      "Something went wrong with the voice loop on my end 🌿 We'll text instead — what would you like to know?",
    );
    await updateState(args.userId, {
      state: "active_free_chat",
      pending_phrase: null,
    });
    return;
  }

  // Agent took over. The post-call webhook will reset state when done.
  // Optionally store the conversation_id for diagnostics; not currently
  // used by any handler.
}
