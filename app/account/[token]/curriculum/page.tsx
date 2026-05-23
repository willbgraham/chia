// Student-facing curriculum dashboard. Lives under the same magic-link
// auth as /account/[token] — the same token gets the student into both
// pages, no separate auth.
//
// Shows the full course (modules → lessons) with per-lesson checkboxes
// the student can tap to mark complete or revert. Reading from
// public.user_lesson_progress; writing via
// POST /api/account/[token]/lesson-progress.
//
// Mobile-first: students click here from a WhatsApp link.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, AlertTriangle } from "lucide-react";
import { getAdminClient } from "@/lib/supabase/admin";
import { verifyAccountToken } from "@/lib/account/magic-link";
import {
  getCurriculumForUser,
  groupByModule,
} from "@/lib/handlers/curriculum";
import type { User, MemoryJson } from "@/types";
import { ModuleCard } from "./ModuleCard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Your Spanish course",
  robots: { index: false, follow: false },
};

const WHATSAPP_NUMBER =
  process.env.NEXT_PUBLIC_CHIA_WHATSAPP_NUMBER ?? "34600974942";
const WHATSAPP_LINK = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent("Hola Chia 🌿")}`;

export default async function CurriculumPage({
  params,
}: {
  params: { token: string };
}) {
  const verified = verifyAccountToken(params.token);
  if (!verified) {
    return <ExpiredOrInvalid />;
  }

  const sb = getAdminClient();
  const { data: userRow } = await sb
    .from("users")
    .select("*")
    .eq("id", verified.userId)
    .single();
  if (!userRow) notFound();
  const user = userRow as User;
  const memory = (user.memory_json ?? {}) as MemoryJson;
  const level = memory.level ?? "beginner";

  // Pull the full curriculum for this student's level. The helper
  // joins lessons + user_lesson_progress and adds the {completed,
  // current} flags we render here.
  const lessons = await getCurriculumForUser(verified.userId, level);
  const modules = groupByModule(lessons, level);

  const totalLessons = lessons.length;
  const completedTotal = lessons.filter((l) => l.completed).length;
  const pct =
    totalLessons === 0 ? 0 : Math.round((completedTotal / totalLessons) * 100);

  return (
    <main className="min-h-screen bg-bg text-text">
      <div className="max-w-2xl mx-auto px-6 py-8">
        <Link
          href={`/account/${params.token}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to your account
        </Link>

        <h1 className="text-3xl font-semibold tracking-tight">
          Your Spanish course
        </h1>
        <p className="mt-1 text-sm text-muted">
          {humanLevel(level)} · {completedTotal} of {totalLessons} lessons done · {pct}%
        </p>

        {/* Progress bar */}
        <div className="mt-4 h-2 rounded-full bg-surface border border-border overflow-hidden">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${pct}%` }}
            aria-hidden
          />
        </div>

        {/* Continue CTA */}
        <a
          href={WHATSAPP_LINK}
          className="mt-6 inline-flex items-center justify-center gap-2 rounded-full bg-accent text-bg px-5 py-2.5 text-sm font-semibold hover:opacity-90"
        >
          Continue with Chia on WhatsApp
          <ExternalLink className="h-3.5 w-3.5" />
        </a>

        {/* Helper text */}
        <p className="mt-6 text-xs text-muted leading-relaxed">
          Check a lesson when you&apos;ve mastered it. Uncheck any time to
          mark it for re-learning — Chia will see your progress and adjust
          what she teaches next.
        </p>

        {/* Modules */}
        <div className="mt-8 space-y-3">
          {modules.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-surface p-6 text-sm text-muted text-center">
              No curriculum set up yet for {humanLevel(level)} 🌿
            </div>
          ) : (
            modules.map((mod, i) => (
              <ModuleCard
                key={mod.name}
                token={params.token}
                module={mod}
                index={i}
              />
            ))
          )}
        </div>

        <p className="mt-12 text-xs text-muted text-center">
          This page is personal to you. The link expires in 24 hours —
          text Chia <span className="text-text">&quot;account&quot;</span>{" "}
          on WhatsApp for a fresh one.
        </p>
      </div>
    </main>
  );
}

function humanLevel(level: string): string {
  if (level === "beginner") return "Beginner (A1)";
  if (level === "intermediate") return "Intermediate (A2)";
  if (level === "advanced") return "Advanced (B1–C1)";
  return level.charAt(0).toUpperCase() + level.slice(1);
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
