"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Input";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    params.get("error") === "unauthorized"
      ? "That account is not the configured admin."
      : null,
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (authError) {
      setError(authError.message);
      setBusy(false);
      return;
    }

    const dest = params.get("from") ?? "/admin/dashboard";
    router.push(dest);
    router.refresh();
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <Field label="Email" htmlFor="email">
        <Input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </Field>
      <Button type="submit" loading={busy} className="w-full">
        Sign in
      </Button>
      {error ? (
        <p className="text-xs text-danger text-center">{error}</p>
      ) : null}
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6 shadow-xl">
        <div className="mb-6 text-center">
          <div className="text-xl font-semibold text-text">ChiaChat Admin</div>
          <div className="mt-1 text-xs text-muted">
            Sign in with the configured admin account
          </div>
        </div>
        <Suspense fallback={<div className="text-sm text-muted">Loading…</div>}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
