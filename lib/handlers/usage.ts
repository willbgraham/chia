// Audio usage metering. Counts characters per user per billing period
// against their plan limit (free=0, premium=50000).
// Also: daily text-message throttle (free=50/day, premium=500/day soft cap)
// to bound OpenAI spend per user.

import { getAdminClient } from "@/lib/supabase/admin";
import { AUDIO_LIMITS, type AudioSource, type AudioDirection, type Plan } from "@/types";
import { TRIAL_AUDIO_CAP_CHARS } from "@/lib/handlers/plan";

interface UsageInsert {
  user_id: string;
  characters_used: number;
  source: AudioSource;
  direction: AudioDirection;
}

export async function logAudioUsage(args: UsageInsert): Promise<void> {
  if (args.characters_used <= 0) return;
  const sb = getAdminClient();
  const { error } = await sb.from("audio_usage").insert(args);
  if (error) throw new Error(`logAudioUsage: ${error.message}`);
}

export async function charactersUsedThisPeriod(
  userId: string,
  billingPeriodStart: string | null,
): Promise<number> {
  const sb = getAdminClient();
  // If no billing period set, fall back to current calendar month.
  const since = billingPeriodStart ?? monthStartIso();
  const { data, error } = await sb
    .from("audio_usage")
    .select("characters_used")
    .eq("user_id", userId)
    .gte("created_at", since);
  if (error) throw new Error(`charactersUsed: ${error.message}`);
  return (data ?? []).reduce(
    (acc, row) => acc + (row.characters_used ?? 0),
    0,
  );
}

// Quota check. `plan` here is the EFFECTIVE plan from
// getEffectivePlan (paid OR trial); `isTrialUser` distinguishes the
// two cases so trial users get a small audio cap (TRIAL_AUDIO_CAP_CHARS)
// while paid users get the full premium quota (AUDIO_LIMITS.premium).
// This prevents a bad-actor trial from torching $30 of ElevenLabs on
// one user while still letting them taste the experience.
export async function isWithinLimit(
  userId: string,
  plan: Plan,
  billingPeriodStart: string | null,
  additional = 0,
  isTrialUser = false,
): Promise<{ ok: boolean; used: number; limit: number; remaining: number }> {
  const baseLimit = AUDIO_LIMITS[plan];
  const limit =
    isTrialUser && plan === "premium" ? TRIAL_AUDIO_CAP_CHARS : baseLimit;
  const used = await charactersUsedThisPeriod(userId, billingPeriodStart);
  const remaining = Math.max(0, limit - used);
  return {
    ok: used + additional <= limit,
    used,
    limit,
    remaining,
  };
}

function monthStartIso(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

// ── Daily text-message throttle ────────────────────────────────────────────
// Soft cap on inbound text messages per UTC day so a runaway user can't
// burn through OpenAI credits. Counter lives on the users row
// (messages_today_count / messages_today_date) and resets lazily when the
// stored date != today. Increments before handler dispatch.

function dailyTextLimit(plan: Plan): number {
  if (plan === "premium") {
    const v = Number(process.env.PREMIUM_DAILY_TEXT_LIMIT);
    return Number.isFinite(v) && v > 0 ? v : 500;
  }
  const v = Number(process.env.FREE_DAILY_TEXT_LIMIT);
  return Number.isFinite(v) && v > 0 ? v : 50;
}

function utcDateString(): string {
  // YYYY-MM-DD in UTC, matching Postgres `date` casting on current_date.
  return new Date().toISOString().slice(0, 10);
}

export interface DailyTextCheck {
  allowed: boolean;
  count: number;     // post-increment count (or stored count if blocked)
  limit: number;
  justHitLimit: boolean; // true on the exact turn we cross the limit
}

// Atomic-ish: read row, decide reset/increment, write back. Race conditions
// across concurrent inbound webhooks for the same user are tolerable here —
// a one-off off-by-one in a soft cap is fine.
export async function checkAndIncrementDailyTextCount(
  userId: string,
  plan: Plan,
): Promise<DailyTextCheck> {
  const sb = getAdminClient();
  const limit = dailyTextLimit(plan);
  const today = utcDateString();

  const { data, error } = await sb
    .from("users")
    .select("messages_today_count, messages_today_date")
    .eq("id", userId)
    .single();
  if (error) {
    // Fail open — never block messages because of a metering glitch.
    console.error("[usage] daily-text-throttle read failed:", error.message);
    return { allowed: true, count: 0, limit, justHitLimit: false };
  }

  const storedDate = (data?.messages_today_date as string | null) ?? null;
  const storedCount = Number(data?.messages_today_count ?? 0);
  const sameDay = storedDate === today;
  const previous = sameDay ? storedCount : 0;

  if (previous >= limit) {
    return { allowed: false, count: previous, limit, justHitLimit: false };
  }

  const next = previous + 1;
  const { error: upErr } = await sb
    .from("users")
    .update({
      messages_today_count: next,
      messages_today_date: today,
    })
    .eq("id", userId);
  if (upErr) {
    console.error("[usage] daily-text-throttle write failed:", upErr.message);
    // Fail open if the write blew up.
    return { allowed: true, count: next, limit, justHitLimit: false };
  }

  return {
    allowed: true,
    count: next,
    limit,
    justHitLimit: next === limit,
  };
}
