import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

// Used inside server components and route handlers where we need
// the *user's* session (e.g. /admin/login → set cookie). For raw DB
// access bypassing RLS, use lib/supabase/admin.ts instead.
export function createClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options: CookieOptions }[],
        ) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Setting cookies from a Server Component is a no-op;
            // middleware refreshes the session so this is safe to ignore.
          }
        },
      },
    },
  );
}
