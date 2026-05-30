// Trial-expiry cron. Runs daily (see vercel.json schedule). For every
// user whose 7-day Premium trial has elapsed, sends a soft "your trial
// ended — keep it? here's the link" message + nulls trial_ends_at so
// the audio gates revert to free.
//
// Idempotent: a user whose trial_ends_at is already NULL is skipped.
// Resilient: send failures don't block the row update — we'd rather
// occasionally miss a conversion message than leave someone "stuck"
// on premium after their trial expires.

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
  const nowIso = new Date().toISOString();
  const stripeLink = process.env.STRIPE_PREMIUM_PAYMENT_LINK ?? "";

  // Pull all rows that have an expired trial (trial_ends_at < now AND
  // not null). We use the partial index from the migration here.
  const { data: users, error } = await sb
    .from("users")
    .select("id, whatsapp_number, memory_json, plan")
    .lt("trial_ends_at", nowIso)
    .not("trial_ends_at", "is", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let sent = 0;
  let cleared = 0;
  for (const u of users ?? []) {
    const name = (u.memory_json as { name?: string } | null)?.name ?? "amig@";

    // Only nudge users who are STILL on free — paid users somehow
    // having an expired trial means the upgrade happened mid-window
    // and the trial_ends_at field is just stale metadata. Clear it
    // silently, no nudge needed.
    if (u.plan === "free") {
      const link = stripeLink
        ? `${stripeLink}${stripeLink.includes("?") ? "&" : "?"}client_reference_id=${u.id}`
        : "";
      const msg = link
        ? `${name}, your 7-day Premium trial just wrapped 🌿\n\nMy voice notes were the highlight, right? 😊 Keep them flowing for €25/month — cancel anytime:\n${link}\n\n(Reply *no thanks* if you want to stay on free — totally fine.)`
        : `${name}, your 7-day Premium trial just wrapped 🌿\n\nReach out via /account if you'd like to keep voice + photos. Otherwise, you're back on free.`;
      try {
        await sendText(u.whatsapp_number, msg);
        await logMessage({
          userId: u.id,
          role: "assistant",
          content: `[trial-expired-nudge] ${msg.slice(0, 200)}...`,
        });
        sent++;
      } catch (err) {
        console.error("[trial-expiry] send failed for", u.id, err);
      }
    }

    // Null trial_ends_at regardless — the timer is done. If they
    // upgrade later, the existing premium flow handles it.
    await sb.from("users").update({ trial_ends_at: null }).eq("id", u.id);
    cleared++;
  }

  return NextResponse.json({ ok: true, sent, cleared });
}

function isAuthorisedCron(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const auth = request.headers.get("authorization") ?? "";
  return auth === `Bearer ${expected}`;
}
