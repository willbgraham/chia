// Helpers for reading, merging, and writing users.memory_json.

import { getAdminClient } from "@/lib/supabase/admin";
import type { MemoryJson } from "@/types";

export async function getMemory(userId: string): Promise<MemoryJson> {
  const sb = getAdminClient();
  const { data, error } = await sb
    .from("users")
    .select("memory_json")
    .eq("id", userId)
    .single();
  if (error) throw new Error(`getMemory: ${error.message}`);
  return (data?.memory_json as MemoryJson | null) ?? {};
}

export async function setMemory(
  userId: string,
  memory: MemoryJson,
): Promise<void> {
  const sb = getAdminClient();
  const { error } = await sb
    .from("users")
    .update({ memory_json: memory })
    .eq("id", userId);
  if (error) throw new Error(`setMemory: ${error.message}`);
}

// Merge a partial update into existing memory. Use this for shallow patches
// (e.g. setting a name); the GPT memory updater scenario does deep merges
// using its own logic.
export async function patchMemory(
  userId: string,
  patch: Partial<MemoryJson>,
): Promise<MemoryJson> {
  const current = await getMemory(userId);
  const updated: MemoryJson = {
    ...current,
    ...patch,
    last_session: new Date().toISOString(),
  };
  await setMemory(userId, updated);
  return updated;
}
