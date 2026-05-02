// Helpers for reading and updating users.conversation_state.
// Encapsulates the state machine so handlers don't directly poke Supabase.

import { getAdminClient } from "@/lib/supabase/admin";
import type { ConversationStateName, ConversationState } from "@/types";

export async function getOrCreateState(
  userId: string,
): Promise<ConversationState> {
  const sb = getAdminClient();
  const { data, error } = await sb
    .from("conversation_state")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`getOrCreateState: ${error.message}`);
  if (data) return data as ConversationState;

  const { data: created, error: insErr } = await sb
    .from("conversation_state")
    .insert({ user_id: userId, state: "onboarding_step_1" })
    .select("*")
    .single();
  if (insErr) throw new Error(`getOrCreateState insert: ${insErr.message}`);
  return created as ConversationState;
}

export async function updateState(
  userId: string,
  patch: Partial<{
    state: ConversationStateName;
    pending_phrase: string | null;
    pending_audio_url: string | null;
  }>,
): Promise<void> {
  const sb = getAdminClient();
  const { data, error } = await sb
    .from("conversation_state")
    .update({
      ...patch,
      last_message_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .select("id");
  if (error) throw new Error(`updateState: ${error.message}`);
  if (!data || data.length === 0) {
    // No row to update — likely a bug upstream where the state row
    // wasn't created before the first update. Log loudly.
    console.error(
      `[updateState] no conversation_state row for user ${userId} — patch ignored`,
      patch,
    );
  }
}

// Touch last_message_at without changing state. Used to keep idle detection
// accurate after every inbound message.
export async function touchLastMessage(userId: string): Promise<void> {
  const sb = getAdminClient();
  await sb
    .from("conversation_state")
    .update({ last_message_at: new Date().toISOString() })
    .eq("user_id", userId);
}
