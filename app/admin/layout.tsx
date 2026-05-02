// Pass-through. The sidebar shell lives in app/admin/(authed)/layout.tsx
// so /admin/login can render full-screen without it.
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
