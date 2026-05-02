import { getAdminClient } from "@/lib/supabase/admin";
import { StatsCard } from "@/components/admin/StatsCard";
import { formatNumber } from "@/lib/utils";

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
  const s = await fetchStats();

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
    </div>
  );
}
