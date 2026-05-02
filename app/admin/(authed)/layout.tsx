import { Sidebar } from "@/components/admin/Sidebar";

// Wraps all authed admin pages with the persistent sidebar shell.
// /admin/login lives outside this route group so it renders without
// the sidebar.
export default function AuthedAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto scrollbar-thin">{children}</main>
    </div>
  );
}
