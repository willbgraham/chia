import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { sendTemplate } from "@/lib/messaging/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Hourly reminder cron. Vercel scheduled via vercel.json.
// Finds users with reminder_preference != 'none' whose reminder_time
// matches the current UTC hour, and who haven't messaged recently. Sends
// the chiachat_lesson_reminder template via Meta.

export async function GET(request: NextRequest) {
  if (!isAuthorisedCron(request)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  const sb = getAdminClient();
  const now = new Date();
  const currentHourPrefix = `${String(now.getUTCHours()).padStart(2, "0")}:`; // "HH:"

  // Pull every user with reminders on whose time starts with the current hour.
  // (We match by hour, not exact minute, since cron fires once per hour.)
  const { data: users, error } = await sb
    .from("users")
    .select("id, whatsapp_number, reminder_preference, reminder_time, memory_json, teacher_id")
    .neq("reminder_preference", "none")
    .like("reminder_time", `${currentHourPrefix}%`);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let sent = 0;
  let skipped = 0;
  for (const u of users ?? []) {
    // Filter by last activity threshold.
    const lastSession = (u.memory_json as { last_session?: string } | null)
      ?.last_session;
    const lastMs = lastSession ? new Date(lastSession).getTime() : 0;
    const ageHours = (Date.now() - lastMs) / (1000 * 60 * 60);

    const threshold =
      u.reminder_preference === "daily"
        ? 23
        : u.reminder_preference === "few_days"
          ? 24 * 3
          : Number.POSITIVE_INFINITY;

    if (ageHours < threshold) {
      skipped++;
      continue;
    }

    // Look up the teacher's name (Chia, in MVP).
    const { data: teacher } = await sb
      .from("teachers")
      .select("name")
      .eq("id", u.teacher_id ?? "")
      .maybeSingle();

    const studentName =
      (u.memory_json as { name?: string } | null)?.name ?? "amig@";
    const teacherName = (teacher?.name as string) ?? "Chia";

    const result = await sendTemplate(
      u.whatsapp_number as string,
      "chiachat_lesson_reminder",
      "en",
      [studentName, teacherName],
    );
    if (result.error) {
      console.error("[reminders] send error:", result.error, "user:", u.id);
      continue;
    }
    sent++;
  }

  return NextResponse.json({
    sent,
    skipped,
    eligible: users?.length ?? 0,
  });
}

function isAuthorisedCron(request: NextRequest): boolean {
  // Vercel sends Authorization: Bearer <CRON_SECRET> on cron invocations.
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const auth = request.headers.get("authorization") ?? "";
  return auth === `Bearer ${expected}`;
}
