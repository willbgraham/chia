"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Input";

export default function NewTeacherPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    language: "Spanish",
    gender: "female",
    nationality: "",
    age: "",
    whatsapp_number: "",
    elevenlabs_voice_id: "",
    elevenlabs_agent_id: "",
    system_prompt: "",
    agent_voice_prompt: "",
    backstory: "",
  });

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/teachers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          age: form.age ? Number(form.age) : null,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "create failed");
      }
      const j = (await res.json()) as { teacher: { id: string } };
      router.push(`/admin/teachers/${j.teacher.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-8 max-w-3xl">
      <Link
        href="/admin/teachers"
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to teachers
      </Link>
      <h1 className="text-2xl font-semibold text-text">New teacher</h1>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <Input
              required
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>
          <Field label="Language">
            <Input
              required
              value={form.language}
              onChange={(e) => set("language", e.target.value)}
            />
          </Field>
          <Field label="Gender">
            <select
              value={form.gender}
              onChange={(e) => set("gender", e.target.value)}
              className="w-full rounded-md bg-surface border border-border px-3 py-2 text-sm text-text"
            >
              <option value="female">female</option>
              <option value="male">male</option>
            </select>
          </Field>
          <Field label="Nationality">
            <Input
              value={form.nationality}
              onChange={(e) => set("nationality", e.target.value)}
            />
          </Field>
          <Field label="Age">
            <Input
              type="number"
              value={form.age}
              onChange={(e) => set("age", e.target.value)}
            />
          </Field>
          <Field label="WhatsApp number">
            <Input
              value={form.whatsapp_number}
              onChange={(e) => set("whatsapp_number", e.target.value)}
              placeholder="+34..."
            />
          </Field>
          <Field label="ElevenLabs voice ID">
            <Input
              value={form.elevenlabs_voice_id}
              onChange={(e) => set("elevenlabs_voice_id", e.target.value)}
            />
          </Field>
          <Field label="ElevenLabs agent ID">
            <Input
              value={form.elevenlabs_agent_id}
              onChange={(e) => set("elevenlabs_agent_id", e.target.value)}
            />
          </Field>
        </div>
        <Field label="System prompt (text/GPT)" hint="for Make → GPT text turns">
          <Textarea
            rows={10}
            value={form.system_prompt}
            onChange={(e) => set("system_prompt", e.target.value)}
          />
        </Field>
        <Field
          label="Agent voice prompt (ElevenLabs agent)"
          hint="short — for voice corrections"
        >
          <Textarea
            rows={6}
            value={form.agent_voice_prompt}
            onChange={(e) => set("agent_voice_prompt", e.target.value)}
          />
        </Field>
        <Field label="Backstory">
          <Textarea
            rows={4}
            value={form.backstory}
            onChange={(e) => set("backstory", e.target.value)}
          />
        </Field>
        <div className="flex items-center gap-3">
          <Button type="submit" loading={busy}>
            Create teacher
          </Button>
          {error ? <span className="text-xs text-danger">{error}</span> : null}
        </div>
      </form>
    </div>
  );
}
