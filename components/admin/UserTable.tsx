"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { User } from "@/types";
import { Badge } from "@/components/ui/Badge";
import { formatDate, formatRelativeTime, maskWhatsAppNumber } from "@/lib/utils";

interface UserTableProps {
  users: User[];
}

export function UserTable({ users }: UserTableProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (users.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted">
        No users yet.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-bg text-muted text-xs uppercase tracking-wide">
          <tr>
            <th className="text-left px-4 py-2.5 font-medium w-8" />
            <th className="text-left px-4 py-2.5 font-medium">WhatsApp</th>
            <th className="text-left px-4 py-2.5 font-medium">Plan</th>
            <th className="text-left px-4 py-2.5 font-medium">Reminders</th>
            <th className="text-left px-4 py-2.5 font-medium">Joined</th>
            <th className="text-left px-4 py-2.5 font-medium">Last update</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const isOpen = expanded === u.id;
            return (
              <Fragment key={u.id}>
                <tr
                  className="border-t border-border hover:bg-bg cursor-pointer"
                  onClick={() => setExpanded(isOpen ? null : u.id)}
                >
                  <td className="px-4 py-2.5 text-muted">
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-text">
                    {maskWhatsAppNumber(u.whatsapp_number)}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={u.plan === "premium" ? "accent" : "neutral"}>
                      {u.plan}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-text">
                    {u.reminder_preference}
                    {u.reminder_time ? ` @ ${u.reminder_time}` : ""}
                  </td>
                  <td className="px-4 py-2.5 text-muted">
                    {formatDate(u.created_at)}
                  </td>
                  <td className="px-4 py-2.5 text-muted">
                    {formatRelativeTime(u.updated_at)}
                  </td>
                </tr>
                {isOpen ? (
                  <tr className="border-t border-border bg-bg">
                    <td colSpan={6} className="px-4 py-3">
                      <UserDetailPanel user={u} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface RecentMessage {
  role: "user" | "assistant";
  content: string;
}

function UserDetailPanel({ user }: { user: User }) {
  const memory = user.memory_json as {
    _recent?: RecentMessage[];
    name?: string;
    [key: string]: unknown;
  };
  const recent = Array.isArray(memory?._recent) ? memory._recent : [];

  // Build a "memory minus _recent" object for the JSON column so the
  // raw JSON view doesn't drown out the high-signal facts (name, level,
  // language progress, etc.) with the message buffer.
  const memorySansRecent = { ...memory };
  delete memorySansRecent._recent;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase text-muted">
            Recent conversation
            <span className="ml-2 text-muted/70">
              ({recent.length} {recent.length === 1 ? "turn" : "turns"})
            </span>
          </div>
        </div>
        {recent.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted">
            No recent messages buffered.
          </div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto scrollbar-thin pr-1">
            {recent.map((m, i) => (
              <div
                key={i}
                className={
                  m.role === "user"
                    ? "rounded-md bg-surface border border-border p-2 text-sm"
                    : "rounded-md bg-accentMuted/40 border border-accent/20 p-2 text-sm"
                }
              >
                <div className="text-[10px] uppercase tracking-wide text-muted mb-0.5">
                  {m.role === "user"
                    ? `${memory?.name ?? "Student"}`
                    : "Chia"}
                </div>
                <div className="whitespace-pre-wrap text-text">
                  {m.content}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="text-xs uppercase text-muted">memory_json</div>
        <pre className="text-xs bg-surface border border-border rounded p-2 overflow-x-auto scrollbar-thin max-h-96">
          {JSON.stringify(memorySansRecent, null, 2)}
        </pre>
        <div className="space-y-1 text-xs pt-2 border-t border-border">
          <div>
            <span className="text-muted">id: </span>
            <span className="font-mono text-text">{user.id}</span>
          </div>
          <div>
            <span className="text-muted">stripe customer: </span>
            <span className="font-mono text-text">
              {user.stripe_customer_id ?? "—"}
            </span>
          </div>
          <div>
            <span className="text-muted">billing start: </span>
            <span className="text-text">
              {formatDate(user.billing_period_start)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
