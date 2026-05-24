import { getAdminClient } from "@/lib/supabase/admin";
import { StatsCard } from "@/components/admin/StatsCard";
import { formatNumber, formatRelativeTime } from "@/lib/utils";
import { fetchFunnelStats } from "@/lib/handlers/funnel-stats";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function fetchStats() {
  const sb = getAdminClient();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [
    { count: totalUsers },
    { count: activeUsers },
    { count: freeUsers },
    { count: premiumUsers },
    { count: newSignups },
    { data: monthAudio },
    { count: agentSessions },
  ] = await Promise.all([
    sb.from("users").select("id", { count: "exact", head: true }),
    sb
      .from("users")
      .select("id", { count: "exact", head: true })
      .gte("updated_at", sevenDaysAgo),
    sb
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("plan", "free"),
    sb
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("plan", "premium"),
    sb
      .from("users")
      .select("id", { count: "exact", head: true })
      .gte("created_at", sevenDaysAgo),
    sb
      .from("audio_usage")
      .select("characters_used")
      .gte("created_at", monthStart.toISOString()),
    sb
      .from("audio_usage")
      .select("id", { count: "exact", head: true })
      .eq("source", "elevenlabs_agent")
      .gte("created_at", monthStart.toISOString()),
  ]);

  const monthChars = (monthAudio ?? []).reduce(
    (acc, row) => acc + (row.characters_used ?? 0),
    0,
  );

  return {
    totalUsers: totalUsers ?? 0,
    activeUsers: activeUsers ?? 0,
    freeUsers: freeUsers ?? 0,
    premiumUsers: premiumUsers ?? 0,
    newSignups: newSignups ?? 0,
    monthChars,
    agentSessions: agentSessions ?? 0,
  };
}

export default async function DashboardPage() {
  // Fetch the high-level stats + the funnel breakdown in parallel.
  const [s, funnel] = await Promise.all([fetchStats(), fetchFunnelStats()]);

  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const totalNew30d = funnel.signups.last_30d;
  const completedOnboarding =
    funnel.signups.total - funnel.onboarding.in_progress;
  const onboardingRate =
    funnel.signups.total > 0
      ? completedOnboarding / funnel.signups.total
      : 0;

  return (
    <div className="p-8 max-w-6xl">
      <h1 className="text-2xl font-semibold text-text">Dashboard</h1>
      <p className="mt-1 text-sm text-muted">
        Live stats — refreshes on every load.
      </p>

      <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          label="Total users"
          value={formatNumber(s.totalUsers)}
        />
        <StatsCard
          label="Active 7d"
          value={formatNumber(s.activeUsers)}
          hint="messaged in last 7 days"
        />
        <StatsCard
          label="New this week"
          value={formatNumber(s.newSignups)}
        />
        <StatsCard
          label="Free / Premium"
          value={`${s.freeUsers} / ${s.premiumUsers}`}
        />
        <StatsCard
          label="Audio chars (month)"
          value={formatNumber(s.monthChars)}
          hint="combined Make + agent"
        />
        <StatsCard
          label="Agent sessions (month)"
          value={formatNumber(s.agentSessions)}
          hint="ElevenLabs voice exchanges"
        />
      </div>

      {/* ── Acquisition funnel ───────────────────────────────────── */}
      <div className="mt-12">
        <h2 className="text-lg font-semibold text-text">Acquisition funnel</h2>
        <p className="mt-1 text-xs text-muted">
          Live conversion picture. Stuck-in-onboarding users are
          candidates for a re-engagement nudge.
        </p>

        <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard
            label="Signups 30d"
            value={formatNumber(totalNew30d)}
            hint={`${formatNumber(funnel.signups.last_7d)} last 7 days`}
          />
          <StatsCard
            label="Finished onboarding"
            value={`${formatNumber(completedOnboarding)} (${pct(onboardingRate)})`}
            hint={`${funnel.onboarding.in_progress} still in onboarding`}
          />
          <StatsCard
            label="Stuck 24h+"
            value={formatNumber(funnel.onboarding.stuck_24h_plus)}
            hint="silent during onboarding ≥24h"
          />
          <StatsCard
            label="Premium conversion"
            value={pct(funnel.plan.premium_conversion)}
            hint={`${funnel.plan.premium}/${funnel.signups.total} are paid`}
          />
        </div>

        <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard
            label="Active 7d (msg)"
            value={formatNumber(funnel.activity.active_7d)}
            hint="messaged in last 7 days"
          />
          <StatsCard
            label="Active 30d (msg)"
            value={formatNumber(funnel.activity.active_30d)}
            hint="messaged in last 30 days"
          />
          <StatsCard
            label="Messages total"
            value={formatNumber(funnel.messages.total)}
            hint={`${formatNumber(funnel.messages.last_7d)} this week`}
          />
          <StatsCard
            label="Avg msgs/user"
            value={String(funnel.messages.avg_per_user)}
            hint="total ÷ total users"
          />
        </div>

        {/* Stuck-in-onboarding watch list */}
        {funnel.stuck_users.length > 0 ? (
          <div className="mt-6 rounded-2xl border border-border bg-surface overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-baseline justify-between">
              <div>
                <h3 className="text-sm font-semibold text-text">
                  Stuck in onboarding
                </h3>
                <p className="mt-0.5 text-xs text-muted">
                  Newest first. Phone numbers masked. These users started
                  but never finished — potential re-engagement targets.
                </p>
              </div>
              <span className="text-xs text-muted">
                {funnel.stuck_users.length} shown
              </span>
            </div>
            <div className="divide-y divide-border">
              {funnel.stuck_users.map((u) => (
                <div
                  key={u.id}
                  className="px-5 py-3 grid grid-cols-12 gap-3 items-center text-sm"
                >
                  <div className="col-span-3 text-text font-mono text-xs">
                    {u.id.slice(0, 8)}…
                  </div>
                  <div className="col-span-3 text-text">
                    {u.name ?? <span className="text-muted">(no name)</span>}
                  </div>
                  <div className="col-span-3 text-xs text-muted">
                    {u.state}
                  </div>
                  <div className="col-span-3 text-xs text-muted text-right">
                    {u.last_message_at
                      ? formatRelativeTime(u.last_message_at)
                      : "never"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-6 rounded-2xl border border-dashed border-border bg-surface p-6 text-center text-sm text-muted">
            🌿 Nobody is stuck in onboarding right now.
          </div>
        )}
      </div>

      {/* Tiny utility chip pointing to the JSON endpoint, so you can
          paste it into a spreadsheet / cron / Slack message later. */}
      <p className="mt-8 text-xs text-muted">
        Funnel data is also available as JSON:{" "}
        <code className="text-text font-mono">/api/admin/funnel</code>
      </p>
    </div>
  );
}
