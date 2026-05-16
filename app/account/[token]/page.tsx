// Student-facing account dashboard. Reached via signed magic link
// from Chia in WhatsApp (e.g., "want to manage your account?").
// Token in the path proves identity — see lib/account/magic-link.ts.
//
// Mobile-first by design: students are tapping this link on their
// phone right after texting Chia.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ExternalLink,
  Mail,
  AlertTriangle,
  BookOpen,
  ChevronRight,
} from "lucide-react";
import { getCurriculumForUser } from "@/lib/handlers/curriculum";
import { getAdminClient } from "@/lib/supabase/admin";
import { verifyAccountToken } from "@/lib/account/magic-link";
import { formatDate, maskWhatsAppNumber } from "@/lib/utils";
import { ManageSubscriptionButton } from "./ManageSubscriptionButton";
import type { User } from "@/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Your account",
  robots: { index: false, follow: false },
};

const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL ?? "support@chiachat.com";
const STRIPE_LINK = process.env.STRIPE_PREMIUM_PAYMENT_LINK ?? "";

export default async function AccountPage({
  params,
}: {
  params: { token: string };
}) {
  const verified = verifyAccountToken(params.token);
  if (!verified) {
    return <ExpiredOrInvalid />;
  }

  const sb = getAdminClient();
  const { data: user } = await sb
    .from("users")
    .select("*")
    .eq("id", verified.userId)
    .single();

  if (!user) notFound();
  const u = user as User;

  // Pull lightweight curriculum progress for the "Your course" card —
  // just the counts, not the full lesson list. The detail view lives
  // on /account/[token]/curriculum.
  const level =
    (u.memory_json as { level?: string } | null)?.level ?? "beginner";
  const lessons = await getCurriculumForUser(u.id, level);
  const totalLessons = lessons.length;
  const completedLessons = lessons.filter((l) => l.completed).length;
  const coursePct =
    totalLessons === 0
      ? 0
      : Math.round((completedLessons / totalLessons) * 100);

  return (
    <main className="min-h-screen bg-bg text-text">
      <div className="max-w-2xl mx-auto px-6 py-8">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to chiachat.com
        </Link>

        <h1 className="text-3xl font-semibold tracking-tight">Your account</h1>
        <p className="mt-1 text-sm text-muted">
          Manage your subscription, see what Chia knows about you, and
          contact support.
        </p>

        {/* ── Plan card ──────────────────────────────────────── */}
        <div className="mt-8 rounded-2xl border border-border bg-surface p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted">
                Current plan
              </div>
              <div className="mt-1 text-2xl font-semibold text-text capitalize">
                {u.plan}
                {u.plan === "premium" ? (
                  <span className="ml-2 text-sm font-normal text-muted">
                    €25/month
                  </span>
                ) : null}
              </div>
              {u.plan === "premium" && u.billing_period_start ? (
                <div className="mt-1 text-sm text-muted">
                  Current period started {formatDate(u.billing_period_start)}
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            {u.plan === "premium" && u.stripe_customer_id ? (
              <ManageSubscriptionButton token={params.token} />
            ) : STRIPE_LINK ? (
              <a
                href={`${STRIPE_LINK}${STRIPE_LINK.includes("?") ? "&" : "?"}client_reference_id=${u.id}`}
                className="inline-flex items-center gap-2 rounded-full bg-accent text-bg px-5 py-2.5 text-sm font-semibold hover:opacity-90"
              >
                Upgrade to Premium
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : null}
            <a
              href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`ChiaChat support — ${maskWhatsAppNumber(u.whatsapp_number)}`)}`}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-bg px-5 py-2.5 text-sm text-text hover:border-muted"
            >
              <Mail className="h-4 w-4" />
              Contact support
            </a>
          </div>
        </div>

        {/* ── Profile card ───────────────────────────────────── */}
        <div className="mt-6 rounded-2xl border border-border bg-surface p-6">
          <div className="text-xs uppercase tracking-wide text-muted">
            Profile
          </div>
          <div className="mt-3 space-y-2 text-sm">
            <Row label="WhatsApp" value={maskWhatsAppNumber(u.whatsapp_number)} />
            <Row
              label="Name"
              value={
                (u.memory_json as { name?: string })?.name ?? "—"
              }
            />
            <Row
              label="Native language"
              value={
                (u.memory_json as { native_language?: string })?.native_language ?? "—"
              }
            />
            <Row
              label="Level"
              value={
                (u.memory_json as { level?: string })?.level ?? "—"
              }
            />
            <Row label="Joined" value={formatDate(u.created_at)} />
          </div>
        </div>

        {/* ── Course progress card ───────────────────────────── */}
        <Link
          href={`/account/${params.token}/curriculum`}
          className="mt-6 block rounded-2xl border border-border bg-surface p-6 hover:border-muted transition-colors"
        >
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
              <BookOpen className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-sm font-semibold text-text">
                  Your Spanish course
                </div>
                <div className="text-xs text-muted shrink-0">
                  {completedLessons}/{totalLessons} · {coursePct}%
                </div>
              </div>
              <div className="mt-1 text-xs text-muted">
                See the full course agenda and check off what you&apos;ve learned
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-bg border border-border overflow-hidden">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${coursePct}%` }}
                  aria-hidden
                />
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted shrink-0" aria-hidden />
          </div>
        </Link>

        {/* ── Memory snapshot ───────────────────────────────── */}
        <MemorySnapshot user={u} />

        {/* ── Footer ────────────────────────────────────────── */}
        <p className="mt-12 text-xs text-muted text-center">
          This page is unique to you. Don&apos;t share the link — it expires
          in 24 hours and message Chia &quot;account&quot; for a new one.
        </p>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <div className="text-muted">{label}</div>
      <div className="text-text font-mono text-right">{value}</div>
    </div>
  );
}

function MemorySnapshot({ user }: { user: User }) {
  const memory = user.memory_json as Record<string, unknown>;
  // Don't show the rolling _recent buffer — that's noise.
  const visible = { ...memory };
  delete (visible as { _recent?: unknown })._recent;

  if (Object.keys(visible).length === 0) return null;

  return (
    <details className="mt-6 rounded-2xl border border-border bg-surface p-6">
      <summary className="cursor-pointer text-xs uppercase tracking-wide text-muted">
        What Chia knows about you
      </summary>
      <pre className="mt-3 text-xs bg-bg border border-border rounded-md p-3 overflow-x-auto scrollbar-thin">
        {JSON.stringify(visible, null, 2)}
      </pre>
      <p className="mt-3 text-xs text-muted">
        This is what Chia remembers between conversations. To delete this
        data, email{" "}
        <a className="underline" href={`mailto:${SUPPORT_EMAIL}`}>
          {SUPPORT_EMAIL}
        </a>
        .
      </p>
    </details>
  );
}

function ExpiredOrInvalid() {
  return (
    <main className="min-h-screen bg-bg text-text flex items-center justify-center">
      <div className="max-w-md mx-auto px-6 py-12 text-center">
        <AlertTriangle className="h-10 w-10 text-warn mx-auto mb-4" />
        <h1 className="text-2xl font-semibold tracking-tight">
          This link has expired
        </h1>
        <p className="mt-3 text-sm text-muted">
          Account links are valid for 24 hours. Message Chia on WhatsApp
          with the word <span className="text-text">&quot;account&quot;</span>{" "}
          and she&apos;ll send you a fresh one.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-accent text-bg px-5 py-2.5 text-sm font-semibold hover:opacity-90"
        >
          Back to chiachat.com
        </Link>
      </div>
    </main>
  );
}
