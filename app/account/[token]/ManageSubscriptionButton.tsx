"use client";

import { useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";

// Click handler that POSTs to /api/account/<token>/portal, gets a
// Stripe Customer Portal session URL, and redirects the browser
// there. We can't generate the portal URL on initial page load
// because Stripe portal sessions expire after a few minutes — so
// we generate one on demand right when the student clicks.

export function ManageSubscriptionButton({ token }: { token: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/account/${token}/portal`, {
        method: "POST",
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "couldn't open Stripe");
      }
      const { url } = (await res.json()) as { url: string };
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "something went wrong");
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        onClick={onClick}
        disabled={loading}
        className="inline-flex items-center gap-2 rounded-full bg-accent text-bg px-5 py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-60"
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <ExternalLink className="h-3.5 w-3.5" />
        )}
        Manage subscription
      </button>
      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </div>
  );
}
