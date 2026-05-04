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
import { embedText } from "@/lib/messaging/openai";

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
// even if message logging breaks. Also computes an embedding and
// stores it in the same row so the message is immediately
// available for semantic retrieval on the next turn.
export async function logMessage(args: LogMessageArgs): Promise<void> {
  if (!args.content || args.content.length === 0) return;
  const sb = getAdminClient();

  // Embed in parallel with insert — but we want the embedding on the
  // same row, so await here. Adds ~150-300ms per message log; happens
  // off the user's hot path (we send the WhatsApp reply BEFORE
  // logging) so it doesn't slow visible response time.
  const embedding = await embedText(args.content);

  const { error } = await sb.from("messages").insert({
    user_id: args.userId,
    role: args.role,
    content: args.content,
    audio_url: args.audioUrl ?? null,
    image_url: args.imageUrl ?? null,
    // pgvector accepts a JS number array; supabase-js serializes it.
    embedding,
  });
  if (error) {
    console.error("[messages] log failed:", error.message);
  }
}

// Semantic retrieval: given a query text (typically the student's
// current message), find the K most similar past messages from this
// user via cosine similarity in the HNSW index. Used to inject
// long-range context into Chia's prompt so she can reference things
// from weeks ago, not just the rolling 20-message buffer.
//
// Excludes very recent messages (last 30 min) since those are
// already in the rolling buffer — duplicating them in the prompt
// wastes tokens.
export async function findRelevantMessages(
  userId: string,
  queryText: string,
  k = 5,
): Promise<MessageRow[]> {
  const queryEmbedding = await embedText(queryText);
  if (!queryEmbedding) return [];

  const sb = getAdminClient();
  // Postgres can't directly compare via supabase-js without RPC.
  // Use the rest API's `rpc` for the vector match. Simpler: a SQL
  // function we define as a one-liner. But to keep this commit
  // self-contained, do an inline ORDER BY embedding <=> $1 via
  // the postgres rest client's order chaining.
  //
  // Workaround: use rpc with a SQL function. Cleaner. Add the
  // function in a tiny migration alongside this file.
  const { data, error } = await sb.rpc("find_relevant_messages", {
    p_user_id: userId,
    p_query: queryEmbedding,
    p_limit: k,
  });
  if (error) {
    console.error("[messages] semantic search failed:", error.message);
    return [];
  }
  return (data ?? []) as MessageRow[];
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
