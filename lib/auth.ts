import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/utils";

// Call at the top of every /api/admin/* route handler. Returns
// `null` when the caller is the configured admin, otherwise returns
// a 401 NextResponse the handler should immediately return.
export async function requireAdmin(): Promise<NextResponse | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
