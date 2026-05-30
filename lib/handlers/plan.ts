// Plan helpers — collapses the (paid plan ∪ active trial) → "effective
// premium" decision into one place so every gate (audio quota, voice
// note pipeline, PDF send, etc.) gets it right without each one
// rolling its own date math.
//
// Three states a user can be in:
//   1. plan="premium"                                   → paid, full quota
//   2. plan="free"  AND trial_ends_at > now()           → trial, capped quota
//   3. plan="free"  AND (trial_ends_at IS NULL or expired) → free, no audio
//
// The cron at /api/cron/trial-expiry nulls trial_ends_at when it
// passes and sends a conversion message. Between expiry and the
// cron run, getEffectivePlan still returns "free" because the date
// check happens here every read.

import type { Plan, User } from "@/types";

// Trial gives "premium-feeling" access for 7 days, but at a CAPPED
// audio quota so a bad actor can't burn the budget. 5,000 chars ≈
// 10 voice messages — plenty to feel the experience, not enough to
// blow $30 of ElevenLabs spend on one trial user.
export const TRIAL_AUDIO_CAP_CHARS = 5000;
export const TRIAL_LENGTH_DAYS = 7;

interface PlanFields {
  plan: Plan;
  trial_ends_at: string | null;
}

// Returns "premium" if the user is paid OR has an active trial, else
// "free". This is the value EVERY gate should check — never the raw
// users.plan column, because that would leak trial users into the
// free experience even though they should feel premium.
export function getEffectivePlan(user: PlanFields): Plan {
  if (user.plan === "premium") return "premium";
  if (isTrialActive(user)) return "premium";
  return "free";
}

// True iff the user is currently inside their trial window. Used by
// audio-quota gates to pick TRIAL_AUDIO_CAP_CHARS instead of the
// full premium ceiling.
export function isTrialActive(user: PlanFields): boolean {
  if (!user.trial_ends_at) return false;
  return new Date(user.trial_ends_at).getTime() > Date.now();
}

// Helper for the offer/accept flow. Returns true if this user is
// eligible to be GIVEN a trial — paid users don't need one, and
// users mid-trial shouldn't get a second one.
export function isEligibleForTrial(user: PlanFields): boolean {
  if (user.plan === "premium") return false;
  if (isTrialActive(user)) return false;
  return true;
}

// Convenience for any handler that already has the loaded User row.
export function getUserEffectivePlan(user: User): Plan {
  return getEffectivePlan({
    plan: user.plan,
    trial_ends_at: (user as User & { trial_ends_at: string | null })
      .trial_ends_at,
  });
}
