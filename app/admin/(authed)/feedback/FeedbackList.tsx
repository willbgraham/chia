"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Star,
  CheckCircle2,
  Circle,
  Trash2,
  Loader2,
  ChevronDown,
} from "lucide-react";
import { maskWhatsAppNumber, formatRelativeTime } from "@/lib/utils";

export interface FeedbackWithUser {
  id: string;
  user_id: string;
  rating: number | null;
  body: string;
  resolved: boolean;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
  user_whatsapp_number: string;
  user_name: string | null;
  user_plan: string;
}

export function FeedbackList({ items }: { items: FeedbackWithUser[] }) {
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <FeedbackRow key={item.id} item={item} />
      ))}
    </div>
  );
}

function FeedbackRow({ item }: { item: FeedbackWithUser }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [resolved, setResolved] = useState(item.resolved);
  const [adminNotes, setAdminNotes] = useState(item.admin_notes ?? "");
  const [savingNotes, setSavingNotes] = useState(false);
  const [savedNotes, setSavedNotes] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function toggleResolved() {
    setToggling(true);
    try {
      const res = await fetch(
        `/api/admin/feedback/${encodeURIComponent(item.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resolved: !resolved }),
        },
      );
      if (!res.ok) throw new Error(`failed (${res.status})`);
      setResolved(!resolved);
      router.refresh();
    } catch (err) {
      console.error("[feedback] toggle failed", err);
    } finally {
      setToggling(false);
    }
  }

  async function saveAdminNotes() {
    setSavingNotes(true);
    setSavedNotes(false);
    try {
      const res = await fetch(
        `/api/admin/feedback/${encodeURIComponent(item.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            admin_notes: adminNotes.trim().length === 0 ? null : adminNotes,
          }),
        },
      );
      if (!res.ok) throw new Error(`failed (${res.status})`);
      setSavedNotes(true);
      setTimeout(() => setSavedNotes(false), 2000);
    } catch (err) {
      console.error("[feedback] notes save failed", err);
    } finally {
      setSavingNotes(false);
    }
  }

  async function onDelete() {
    if (!confirm("Permanently delete this feedback row?")) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/admin/feedback/${encodeURIComponent(item.id)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(`failed (${res.status})`);
      router.refresh();
    } catch (err) {
      console.error("[feedback] delete failed", err);
      setDeleting(false);
    }
  }

  const bodyPreview =
    item.body.length > 180 ? item.body.slice(0, 180) + "…" : item.body;
  const displayName =
    item.user_name ?? maskWhatsAppNumber(item.user_whatsapp_number);

  return (
    <div
      className={
        "rounded-2xl border bg-surface " +
        (resolved
          ? "border-border opacity-70"
          : "border-border")
      }
    >
      {/* Header row */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-5 py-4 flex items-start gap-3"
      >
        {/* Star rating column */}
        <div className="flex flex-col items-center justify-start pt-0.5 w-10 shrink-0">
          {item.rating !== null ? (
            <div className="flex items-center gap-0.5">
              <Star className="h-3.5 w-3.5 fill-accent text-accent" />
              <span className="text-xs font-semibold text-text">
                {item.rating}
              </span>
            </div>
          ) : (
            <span className="text-[10px] text-muted">—</span>
          )}
        </div>

        {/* Body + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="text-sm font-semibold text-text truncate">
                {displayName}
              </span>
              <span className="text-[10px] uppercase tracking-wide text-muted">
                {item.user_plan}
              </span>
            </div>
            <span className="text-xs text-muted shrink-0">
              {formatRelativeTime(item.created_at)}
            </span>
          </div>
          <p className="mt-1 text-sm text-text whitespace-pre-wrap break-words">
            {expanded ? item.body : bodyPreview}
          </p>
          {!expanded && item.admin_notes ? (
            <p className="mt-2 text-xs text-muted italic">
              Admin note: {item.admin_notes.slice(0, 80)}
              {item.admin_notes.length > 80 ? "…" : ""}
            </p>
          ) : null}
        </div>

        <ChevronDown
          className={
            "h-4 w-4 text-muted shrink-0 transition-transform " +
            (expanded ? "rotate-180" : "")
          }
          aria-hidden
        />
      </button>

      {/* Expanded controls */}
      {expanded ? (
        <div className="border-t border-border px-5 py-4 space-y-3">
          {/* Admin notes editor */}
          <div>
            <label className="text-[10px] uppercase tracking-wide text-muted">
              Admin notes (private)
            </label>
            <textarea
              value={adminNotes}
              onChange={(e) => setAdminNotes(e.target.value.slice(0, 4000))}
              placeholder="Notes for the team — root cause, follow-up actions, ticket links…"
              rows={3}
              className="mt-1 w-full rounded-lg bg-bg border border-border px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-none focus:border-accent resize-none"
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={saveAdminNotes}
                disabled={savingNotes}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg px-3 py-1.5 text-xs text-text hover:border-muted disabled:opacity-50"
              >
                {savingNotes ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : null}
                Save notes
              </button>
              {savedNotes ? (
                <span className="text-xs text-success">Saved</span>
              ) : null}
            </div>
          </div>

          {/* Action row */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={toggleResolved}
              disabled={toggling}
              className={
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors " +
                (resolved
                  ? "border border-border text-muted hover:text-text"
                  : "bg-accent text-bg hover:opacity-90")
              }
            >
              {toggling ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : resolved ? (
                <Circle className="h-3 w-3" />
              ) : (
                <CheckCircle2 className="h-3 w-3" />
              )}
              {resolved ? "Mark unresolved" : "Mark resolved"}
            </button>

            <button
              type="button"
              onClick={onDelete}
              disabled={deleting}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg px-3 py-1.5 text-xs text-muted hover:text-danger hover:border-danger/40"
            >
              {deleting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
              Delete
            </button>

            <div className="ml-auto text-[10px] text-muted">
              ID: {item.id.slice(0, 8)}… · raw phone:{" "}
              {maskWhatsAppNumber(item.user_whatsapp_number)}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
