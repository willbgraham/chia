// Persistent message log. Every inbound + outbound message goes
// through here. The fast-path rolling buffer (users.memory_json._recent)
// continues to serve as GPT context (kept small + fast); this table
// is the source of truth for history.
//
// Used by:
//   - Admin conversation viewer (full history, not capped at 20)
//   - GDPR data export / deletion
//   - Future: pgvector long-term memory
//   - Future: analytics (avg session length, drop-off points)

import { getAdminClient } from "@/lib/supabase/admin";

export interface MessageRow {
  id: string;
  user_id: string;
  role: "user" | "assistant";
  content: string;
  audio_url: string | null;
  image_url: string | null;
  created_at: string;
}

interface LogMessageArgs {
  userId: string;
  role: "user" | "assistant";
  content: string;
  audioUrl?: string;
  imageUrl?: string;
}

// Log one message to the permanent store. Best-effort — failures
// are logged but don't surface to callers; messaging continues
// even if message logging breaks.
export async function logMessage(args: LogMessageArgs): Promise<void> {
  if (!args.content || args.content.length === 0) return;
  const sb = getAdminClient();
  const { error } = await sb.from("messages").insert({
    user_id: args.userId,
    role: args.role,
    content: args.content,
    audio_url: args.audioUrl ?? null,
    image_url: args.imageUrl ?? null,
  });
  if (error) {
    console.error("[messages] log failed:", error.message);
  }
}

// Fetch the last `limit` messages for a user, in chronological order
// (oldest first). Used by the admin viewer to render the conversation.
export async function getMessages(
  userId: string,
  limit = 100,
): Promise<MessageRow[]> {
  const sb = getAdminClient();
  const { data, error } = await sb
    .from("messages")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[messages] read failed:", error.message);
    return [];
  }
  // Reverse so the oldest message is first (natural reading order).
  return ((data ?? []) as MessageRow[]).reverse();
}
