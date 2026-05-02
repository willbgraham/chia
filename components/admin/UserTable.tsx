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
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <div className="text-xs uppercase text-muted mb-1">
                            memory_json
                          </div>
                          <pre className="text-xs bg-surface border border-border rounded p-2 overflow-x-auto scrollbar-thin">
                            {JSON.stringify(u.memory_json, null, 2)}
                          </pre>
                        </div>
                        <div className="space-y-1.5 text-xs">
                          <div>
                            <span className="text-muted">id: </span>
                            <span className="font-mono text-text">{u.id}</span>
                          </div>
                          <div>
                            <span className="text-muted">stripe customer: </span>
                            <span className="font-mono text-text">
                              {u.stripe_customer_id ?? "—"}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted">billing start: </span>
                            <span className="text-text">
                              {formatDate(u.billing_period_start)}
                            </span>
                          </div>
                        </div>
                      </div>
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
