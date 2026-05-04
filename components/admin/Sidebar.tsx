"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  GraduationCap,
  BookOpen,
  FileText,
  LogOut,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/teachers", label: "Teachers", icon: GraduationCap },
  { href: "/admin/lessons", label: "Lessons", icon: BookOpen },
  { href: "/admin/pdfs", label: "PDFs", icon: FileText },
  { href: "/admin/users", label: "Users", icon: Users },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/admin/login");
    router.refresh();
  }

  return (
    <aside className="flex h-screen w-56 flex-col border-r border-border bg-surface">
      <div className="px-5 py-5 border-b border-border">
        <div className="text-lg font-semibold text-text">ChiaChat</div>
        <div className="text-xs text-muted mt-0.5">Admin</div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-bg text-text"
                  : "text-muted hover:bg-bg hover:text-text",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-border p-3">
        <button
          onClick={handleSignOut}
          className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted hover:bg-bg hover:text-text"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
