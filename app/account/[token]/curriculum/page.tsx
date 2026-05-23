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
  const currentLevel = memory.level ?? "beginner";

  // Fetch the FULL curriculum across all three levels so students
  // see the whole course ahead of them — not just their current
  // level. Modules from other levels stay collapsed by default; the
  // student's current level expands its current module.
  const LEVELS = ["beginner", "intermediate", "advanced"] as const;
  const sections = await Promise.all(
    LEVELS.map(async (lvl) => {
      const lessons = await getCurriculumForUser(verified.userId, lvl);
      const modules = groupByModule(lessons, lvl);
      const total = lessons.length;
      const done = lessons.filter((l) => l.completed).length;
      return { level: lvl, lessons, modules, total, done };
    }),
  );

  // Headline numbers: course-wide total + progress at the student's
  // current level (the most meaningful "% done" for them today).
  const grandTotal = sections.reduce((acc, s) => acc + s.total, 0);
  const grandDone = sections.reduce((acc, s) => acc + s.done, 0);
  const current = sections.find((s) => s.level === currentLevel) ?? sections[0];
  const currentPct =
    current.total === 0 ? 0 : Math.round((current.done / current.total) * 100);

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
          {humanLevel(currentLevel)} · {current.done} of {current.total} lessons
          done · {currentPct}%
        </p>

        {/* Progress bar tracks the user's CURRENT level so the
            percentage feels achievable. Total course count goes in
            the sub-line below. */}
        <div className="mt-4 h-2 rounded-full bg-surface border border-border overflow-hidden">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${currentPct}%` }}
            aria-hidden
          />
        </div>

        {/* Course-wide stats — the "you've got a whole journey ahead" message. */}
        <p className="mt-3 text-xs text-muted">
          Full course: {grandTotal} lessons across A1, A2, B1, B2 & C1 —{" "}
          {grandDone} done total.
        </p>

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

        {/* Sections per level. Each one rendered as a heading + that
            level's modules. Visually clear when a level belongs to the
            student today ("you are here") vs what's ahead. */}
        <div className="mt-10 space-y-10">
          {sections.map((section, sIdx) => {
            const isCurrent = section.level === currentLevel;
            const isFuture =
              LEVELS.indexOf(section.level) >
              LEVELS.indexOf(currentLevel as (typeof LEVELS)[number]);
            if (section.modules.length === 0) return null;
            const sectionPct =
              section.total === 0
                ? 0
                : Math.round((section.done / section.total) * 100);
            return (
              <div key={section.level}>
                <div className="flex items-baseline justify-between gap-3 mb-3">
                  <h2 className="text-lg font-semibold tracking-tight">
                    {humanLevel(section.level)}
                    {isCurrent ? (
                      <span className="ml-2 inline-flex items-center rounded-full bg-accent/15 text-accent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                        You are here
                      </span>
                    ) : null}
                    {isFuture && section.done === 0 ? (
                      <span className="ml-2 inline-flex items-center rounded-full border border-border text-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                        Coming up
                      </span>
                    ) : null}
                  </h2>
                  <span className="text-xs text-muted shrink-0">
                    {section.done}/{section.total} · {sectionPct}%
                  </span>
                </div>
                <div className="space-y-3">
                  {section.modules.map((mod, mIdx) => (
                    <ModuleCard
                      key={`${section.level}-${mod.name}`}
                      token={params.token}
                      module={mod}
                      // Module numbering is global — keep counting
                      // forward across levels so the dashboard reads
                      // as one continuous syllabus.
                      index={moduleGlobalIndex(sections, sIdx, mIdx)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
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

// Compute the global (cross-level) module index for "Module N — name"
// headings. Treats the modules from beginner → intermediate → advanced
// as one continuous list, so the student sees Module 1, 2, 3 … N
// without a per-level reset.
function moduleGlobalIndex(
  sections: { modules: { name: string }[] }[],
  sIdx: number,
  mIdx: number,
): number {
  let offset = 0;
  for (let i = 0; i < sIdx; i++) offset += sections[i].modules.length;
  return offset + mIdx;
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
