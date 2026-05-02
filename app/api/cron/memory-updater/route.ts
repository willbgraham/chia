import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { extractMemoryUpdate } from "@/lib/messaging/openai";
import type { MemoryJson } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Memory-updater cron. Vercel scheduled via vercel.json (every 10 min).
// Finds users whose last message was 20+ min ago AND whose memory hasn't
// been refreshed since their last message. Runs GPT-4o-mini extraction
// and merges new facts into memory_json.

interface BufferedMessage {
  role: "user" | "assistant";
  content: string;
}

export async function GET(request: NextRequest) {
  if (!isAuthorisedCron(request)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  const sb = getAdminClient();
  const idleThreshold = new Date(Date.now() - 20 * 60 * 1000).toISOString();

  // Find idle users — last_message_at on conversation_state is older than
  // 20 min. We then check each one's memory.last_session vs that.
  const { data: idleStates, error } = await sb
    .from("conversation_state")
    .select("user_id, last_message_at")
    .lt("last_message_at", idleThreshold)
    .order("last_message_at", { ascending: false })
    .limit(50); // batch limit per run

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let updated = 0;
  let skipped = 0;
  for (const s of idleStates ?? []) {
    const { data: user } = await sb
      .from("users")
      .select("id, memory_json")
      .eq("id", s.user_id)
      .single();
    if (!user) continue;

    const memory = (user.memory_json as MemoryJson | null) ?? {};
    const lastSession = memory.last_session
      ? new Date(memory.last_session).getTime()
      : 0;
    const lastMessage = new Date(s.last_message_at as string).getTime();

    // Skip if memory was already updated after the last message.
    if (lastSession >= lastMessage) {
      skipped++;
      continue;
    }

    const buf =
      ((memory as unknown as { _recent?: BufferedMessage[] })._recent) ?? [];
    if (buf.length === 0) {
      skipped++;
      continue;
    }

    const newMemory = await extractMemoryUpdate({
      existingMemory: stripTransient(memory),
      recentTranscript: buf,
    });

    // Always preserve the message buffer + bump last_session.
    const merged = {
      ...newMemory,
      _recent: buf,
      last_session: new Date().toISOString(),
    };

    await sb
      .from("users")
      .update({ memory_json: merged })
      .eq("id", user.id);
    updated++;
  }

  return NextResponse.json({
    updated,
    skipped,
    eligible: idleStates?.length ?? 0,
  });
}

function isAuthorisedCron(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const auth = request.headers.get("authorization") ?? "";
  return auth === `Bearer ${expected}`;
}

// Remove transient fields (the _recent buffer) before passing to GPT —
// the model doesn't need to see the buffer in the existing-memory context.
function stripTransient(memory: MemoryJson): MemoryJson {
  const m: MemoryJson & { _recent?: unknown } = { ...memory };
  delete m._recent;
  return m;
}
