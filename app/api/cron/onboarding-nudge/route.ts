// Onboarding re-engagement cron. Runs daily. Finds users who started
// onboarding more than 24h ago and never finished, and sends a single
// soft nudge inviting them to pick up. One nudge per user — we mark
// memory_json.onboarding_nudge_sent_at so we don't spam silent users
// on every cron tick.
//
// Doesn't try to be clever about timing — fires at the daily cron
// hour regardless of user's local time zone. We're not yet at the
// scale where micro-targeting beats the simplicity of "once a day".

import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { sendText } from "@/lib/messaging/whatsapp";
import { logMessage } from "@/lib/handlers/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!isAuthorisedCron(request)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  const sb = getAdminClient();
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Find users whose conversation_state is still onboarding_step_*
  // AND whose last message landed > 24h ago. Join with users so we
  // can read memory_json (for name + nudge-sent flag).
  const { data: rows, error } = await sb
    .from("conversation_state")
    .select(
      "user_id, state, last_message_at, users!inner(id, whatsapp_number, memory_json)",
    )
    .like("state", "onboarding_step_%")
    .lt("last_message_at", oneDayAgo);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Row = {
    user_id: string;
    state: string;
    last_message_at: string | null;
    users: {
      id: string;
      whatsapp_number: string;
      memory_json: { name?: string; onboarding_nudge_sent_at?: string } | null;
    };
  };

  let sent = 0;
  let skipped_already_nudged = 0;
  for (const r of (rows ?? []) as unknown as Row[]) {
    const memory = r.users.memory_json ?? {};
    if (memory.onboarding_nudge_sent_at) {
      skipped_already_nudged++;
      continue;
    }
    const name = memory.name ?? null;
    const msg = name
      ? `Hey ${name} 🌿 looks like we got cut off earlier. Just say hi and we'll pick up where we left off — promise it'll be quick.`
      : `Hey 🌿 looks like we got cut off earlier. Just send me your first name and we'll keep going — promise it'll be quick.`;
    try {
      await sendText(r.users.whatsapp_number, msg);
      await logMessage({
        userId: r.user_id,
        role: "assistant",
        content: `[onboarding-nudge] ${msg}`,
      });
      await sb
        .from("users")
        .update({
          memory_json: {
            ...memory,
            onboarding_nudge_sent_at: new Date().toISOString(),
          },
        })
        .eq("id", r.user_id);
      sent++;
    } catch (err) {
      console.error("[onboarding-nudge] send failed for", r.user_id, err);
    }
  }

  return NextResponse.json({ ok: true, sent, skipped_already_nudged });
}

function isAuthorisedCron(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const auth = request.headers.get("authorization") ?? "";
  return auth === `Bearer ${expected}`;
}
