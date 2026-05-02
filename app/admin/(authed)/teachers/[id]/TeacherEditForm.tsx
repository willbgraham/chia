"use client";

import { useState, type FormEvent } from "react";
import { Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import type { Teacher } from "@/types";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Input";

interface Props {
  teacher: Teacher;
}

export function TeacherEditForm({ teacher }: Props) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: teacher.name,
    language: teacher.language,
    gender: teacher.gender ?? "female",
    nationality: teacher.nationality ?? "",
    age: teacher.age?.toString() ?? "",
    whatsapp_number: teacher.whatsapp_number ?? "",
    elevenlabs_voice_id: teacher.elevenlabs_voice_id ?? "",
    elevenlabs_agent_id: teacher.elevenlabs_agent_id ?? "",
    system_prompt: teacher.system_prompt ?? "",
    agent_voice_prompt: teacher.agent_voice_prompt ?? "",
    backstory: teacher.backstory ?? "",
    is_active: teacher.is_active,
  });
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/teachers/${teacher.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          age: form.age ? Number(form.age) : null,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "save failed");
      }
      setMsg({ ok: true, text: "Saved." });
    } catch (err) {
      setMsg({
        ok: false,
        text: err instanceof Error ? err.message : "save failed",
      });
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!confirm(`Delete ${teacher.name}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/teachers/${teacher.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "delete failed");
      }
      router.push("/admin/teachers");
      router.refresh();
    } catch (err) {
      setMsg({
        ok: false,
        text: err instanceof Error ? err.message : "delete failed",
      });
      setDeleting(false);
    }
  }

  return (
    <form onSubmit={onSave} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <Input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>
        <Field label="Language">
          <Input
            value={form.language}
            onChange={(e) => set("language", e.target.value)}
          />
        </Field>
        <Field label="Gender">
          <select
            value={form.gender}
            onChange={(e) => set("gender", e.target.value as "female" | "male")}
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
        <Field label="Active">
          <label className="flex items-center gap-2 h-10">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => set("is_active", e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm text-text">
              {form.is_active ? "active" : "inactive"}
            </span>
          </label>
        </Field>
        <Field label="WhatsApp number">
          <Input
            value={form.whatsapp_number}
            onChange={(e) => set("whatsapp_number", e.target.value)}
            placeholder="+34..."
          />
        </Field>
        <Field label="ElevenLabs voice ID" hint="for outbound TTS via Make">
          <Input
            value={form.elevenlabs_voice_id}
            onChange={(e) => set("elevenlabs_voice_id", e.target.value)}
          />
        </Field>
        <Field
          label="ElevenLabs agent ID"
          hint="for native voice loop"
        >
          <Input
            value={form.elevenlabs_agent_id}
            onChange={(e) => set("elevenlabs_agent_id", e.target.value)}
          />
        </Field>
        <div /> {/* spacer */}
      </div>

      <Field
        label="System prompt (text/GPT)"
        hint="used by Make for text turns — full personality"
      >
        <Textarea
          rows={14}
          value={form.system_prompt}
          onChange={(e) => set("system_prompt", e.target.value)}
        />
      </Field>

      <Field
        label="Agent voice prompt (ElevenLabs)"
        hint="short — for the voice correction agent"
      >
        <Textarea
          rows={8}
          value={form.agent_voice_prompt}
          onChange={(e) => set("agent_voice_prompt", e.target.value)}
        />
      </Field>

      <Field label="Backstory">
        <Textarea
          rows={5}
          value={form.backstory}
          onChange={(e) => set("backstory", e.target.value)}
        />
      </Field>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button type="submit" loading={busy}>
            <Save className="h-4 w-4" />
            Save
          </Button>
          {msg ? (
            <span
              className={
                msg.ok ? "text-xs text-success" : "text-xs text-danger"
              }
            >
              {msg.text}
            </span>
          ) : null}
        </div>
        <Button
          type="button"
          variant="danger"
          onClick={onDelete}
          loading={deleting}
        >
          <Trash2 className="h-4 w-4" />
          Delete teacher
        </Button>
      </div>
    </form>
  );
}
