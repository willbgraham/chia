// Bare /admin redirects to the dashboard. The middleware runs first
// and bounces unauthenticated requests to /admin/login. Authenticated
// admins hit this page → server redirects to /admin/dashboard.
import { redirect } from "next/navigation";

export default function AdminIndex() {
  redirect("/admin/dashboard");
}
