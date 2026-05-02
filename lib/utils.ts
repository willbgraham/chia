import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Privacy-respecting WhatsApp number masking for the admin user list.
// "+447400123456" → "+44 740 ••• 3456"
export function maskWhatsAppNumber(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.length <= 6) return digits;
  const prefix = digits.slice(0, digits.length - 4 - 3);
  const tail = digits.slice(-4);
  return `${prefix}•••${tail}`;
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  const days = Math.floor(seconds / 86400);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatNumber(n: number): string {
  return n.toLocaleString();
}

// True iff this email is the configured admin. Used by middleware after
// Supabase Auth confirms a session.
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const expected = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!expected) return false;
  return email.trim().toLowerCase() === expected;
}
