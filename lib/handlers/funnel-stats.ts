// Acquisition-funnel statistics. Surfaces the numbers an admin
// actually wants to see — how many sign-ups, how many finished
// onboarding, how many are stuck partway, conversion to premium.
//
// Used by:
//   - app/admin/(authed)/dashboard/page.tsx (rendered as cards)
//   - app/api/admin/funnel/route.ts (JSON endpoint for any future
//     cron / Slack / spreadsheet consumer)

import { getAdminClient } from "@/lib/supabase/admin";

export interface FunnelStats {
  signups: {
    total: number;
    last_7d: number;
    last_30d: number;
  };
  onboarding: {
    // Users currently in any onboarding_step_* state (haven't entered
    // active_free_chat or active_structured_lesson yet).
    in_progress: number;
    // Subset of the above that haven't sent a message in 24h+ —
    // candidates for a re-engagement nudge.
    stuck_24h_plus: number;
  };
  activity: {
    active_7d: number;
    active_30d: number;
    dormant_30d_plus: number;
  };
  plan: {
    free: number;
    premium: number;
    // premium / total — 0..1
    premium_conversion: number;
  };
  trial: {
    // Active right now (trial_ends_at > now() AND plan='free').
    active: number;
    // Total trials ever started.
    total_started: number;
    // Total trials that ended without converting (expired and the
    // user stayed on free).
    expired_no_conversion: number;
  };
  messages: {
    total: number;
    last_7d: number;
    avg_per_user: number;
  };
  // Most recent N users still stuck in onboarding (so you can see WHO
  // to follow up on). Capped at 10.
  stuck_users: Array<{
    id: string;
    name: string | null;
    created_at: string;
    last_message_at: string | null;
    state: string;
  }>;
}

export async function fetchFunnelStats(): Promise<FunnelStats> {
  const sb = getAdminClient();
  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * 86400 * 1000).toISOString();
  const thirtyDaysAgo = new Date(now - 30 * 86400 * 1000).toISOString();
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  // Fire all the count queries in parallel. The big aggregations
  // (messages count, avg per user) and the small lookup (stuck users)
  // are independent so they can run together.
  const [
    totalSignups,
    signups7d,
    signups30d,
    freeCount,
    premiumCount,
    onboardingInProgress,
    onboardingStuck24h,
    active7d,
    active30d,
    messagesTotal,
    messages7d,
    stuckUsersRaw,
  ] = await Promise.all([
    sb.from("users").select("id", { count: "exact", head: true }),
    sb
      .from("users")
      .select("id", { count: "exact", head: true })
      .gte("created_at", sevenDaysAgo),
    sb
      .from("users")
      .select("id", { count: "exact", head: true })
      .gte("created_at", thirtyDaysAgo),
    sb
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("plan", "free"),
    sb
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("plan", "premium"),
    sb
      .from("conversation_state")
      .select("user_id", { count: "exact", head: true })
      .like("state", "onboarding_step_%"),
    sb
      .from("conversation_state")
      .select("user_id", { count: "exact", head: true })
      .like("state", "onboarding_step_%")
      .lt("last_message_at", oneDayAgo),
    sb
      .from("conversation_state")
      .select("user_id", { count: "exact", head: true })
      .gte("last_message_at", sevenDaysAgo),
    sb
      .from("conversation_state")
      .select("user_id", { count: "exact", head: true })
      .gte("last_message_at", thirtyDaysAgo),
    sb.from("messages").select("id", { count: "exact", head: true }),
    sb
      .from("messages")
      .select("id", { count: "exact", head: true })
      .gte("created_at", sevenDaysAgo),
    // Top 10 stuck-in-onboarding users (newest first), joined with
    // user.memory_json.name for display.
    sb
      .from("conversation_state")
      .select(
        "user_id, state, last_message_at, users!inner(id, created_at, memory_json)",
      )
      .like("state", "onboarding_step_%")
      .order("last_message_at", { ascending: false })
      .limit(10),
  ]);

  // Trial-specific counts. trial_offered_at lives in memory_json and
  // isn't worth a top-level column query, so for "total_started" we
  // count distinct users whose memory_json has trial_offered_at — a
  // simple proxy that catches both currently-active and already-expired
  // trials. expired_no_conversion = users with offered + still-free +
  // no active trial right now.
  const nowIso = new Date().toISOString();
  const [trialActiveQ, trialOfferedQ] = await Promise.all([
    sb
      .from("users")
      .select("id", { count: "exact", head: true })
      .gt("trial_ends_at", nowIso),
    // Memory-json filter requires the textual JSON path operator. We
    // pull and count in app code so the query stays portable.
    sb
      .from("users")
      .select("id, memory_json, plan, trial_ends_at")
      .not("memory_json->trial_offered_at", "is", null),
  ]);

  const total = totalSignups.count ?? 0;
  const premium = premiumCount.count ?? 0;
  const totalMsgs = messagesTotal.count ?? 0;
  const dormant30d = Math.max(0, total - (active30d.count ?? 0));

  type StuckRow = {
    user_id: string;
    state: string;
    last_message_at: string | null;
    users: {
      id: string;
      created_at: string;
      memory_json: { name?: string } | null;
    };
  };
  const stuck = ((stuckUsersRaw.data ?? []) as unknown as StuckRow[]).map(
    (row) => ({
      id: row.user_id,
      name: row.users.memory_json?.name ?? null,
      created_at: row.users.created_at,
      last_message_at: row.last_message_at,
      state: row.state,
    }),
  );

  return {
    signups: {
      total,
      last_7d: signups7d.count ?? 0,
      last_30d: signups30d.count ?? 0,
    },
    onboarding: {
      in_progress: onboardingInProgress.count ?? 0,
      stuck_24h_plus: onboardingStuck24h.count ?? 0,
    },
    activity: {
      active_7d: active7d.count ?? 0,
      active_30d: active30d.count ?? 0,
      dormant_30d_plus: dormant30d,
    },
    plan: {
      free: freeCount.count ?? 0,
      premium,
      premium_conversion: total > 0 ? premium / total : 0,
    },
    trial: (() => {
      const totalStarted = trialOfferedQ.data?.length ?? 0;
      const active = trialActiveQ.count ?? 0;
      // Expired-and-not-converted = offered, currently free, and
      // trial_ends_at is either null or in the past.
      const expiredNoConv = (trialOfferedQ.data ?? []).filter((u) => {
        if (u.plan === "premium") return false;
        if (!u.trial_ends_at) return true;
        return new Date(u.trial_ends_at) < new Date();
      }).length;
      return {
        active,
        total_started: totalStarted,
        expired_no_conversion: expiredNoConv,
      };
    })(),
    messages: {
      total: totalMsgs,
      last_7d: messages7d.count ?? 0,
      avg_per_user: total > 0 ? Math.round((totalMsgs / total) * 10) / 10 : 0,
    },
    stuck_users: stuck,
  };
}
