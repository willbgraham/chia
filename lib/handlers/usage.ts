// Audio usage metering. Counts characters per user per billing period
// against their plan limit (free=0, premium=50000).

import { getAdminClient } from "@/lib/supabase/admin";
import { AUDIO_LIMITS, type AudioSource, type AudioDirection, type Plan } from "@/types";

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

export async function isWithinLimit(
  userId: string,
  plan: Plan,
  billingPeriodStart: string | null,
  additional = 0,
): Promise<{ ok: boolean; used: number; limit: number; remaining: number }> {
  const limit = AUDIO_LIMITS[plan];
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
