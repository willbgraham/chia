// Short-URL service. Wraps long magic-link URLs (with ~120-char
// signed tokens) into chiachat.com/c/<6-char-id> redirects that fit
// on a single line in WhatsApp and survive copy-paste.
//
// short_id is 8 chars from a base62 alphabet (~218T combinations) —
// plenty for our scale without ever needing collision retry.
// Persistence: public.short_links table (migration applied).

import crypto from "crypto";
import { getAdminClient } from "@/lib/supabase/admin";

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const SHORT_ID_LENGTH = 8;

function generateShortId(): string {
  // Use crypto.randomInt to pick each character — gives a uniform
  // distribution across the 62-char alphabet. The previous "bytes[i] %
  // ALPHABET.length" approach was slightly biased toward the first
  // (256 % 62 = 8) characters of the alphabet because 256 is not a
  // multiple of 62. Not exploitable at our keyspace (~218T) but worth
  // fixing for correctness.
  let out = "";
  for (let i = 0; i < SHORT_ID_LENGTH; i++) {
    out += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  }
  return out;
}

// Create a short link mapping → full target path. Returns the
// short URL (e.g. https://chiachat.com/c/aB3xK9pQ) ready to send
// in WhatsApp. ttlHours should match the underlying token's TTL so
// the link expires when its target does.
//
// Retries on the rare collision (random hit on an existing row).
export async function createShortLink(
  targetPath: string,
  ttlHours: number,
): Promise<string> {
  const sb = getAdminClient();
  const expiresAt = new Date(
    Date.now() + ttlHours * 60 * 60 * 1000,
  ).toISOString();

  // Try up to 5 inserts. Each attempt has ~zero chance of collision
  // at 218T-space, but better safe than infinite retries.
  for (let attempt = 0; attempt < 5; attempt++) {
    const shortId = generateShortId();
    const { error } = await sb.from("short_links").insert({
      short_id: shortId,
      target_path: targetPath,
      expires_at: expiresAt,
    });
    if (!error) {
      const base =
        process.env.NEXT_PUBLIC_APP_URL ?? "https://chiachat.com";
      return `${base.replace(/\/+$/, "")}/c/${shortId}`;
    }
    // Postgres unique violation code = 23505. Anything else is a real
    // error and we shouldn't retry blindly.
    const errMsg = error.message ?? "";
    if (!errMsg.includes("duplicate key") && !errMsg.includes("unique")) {
      throw new Error(`short_links insert failed: ${errMsg}`);
    }
    // collision — loop and try a fresh id
  }
  throw new Error("short_links: failed to insert after 5 attempts");
}

// Resolve a short_id to its target path, if it exists and hasn't
// expired. Returns null otherwise. Public endpoint /c/[short] uses
// this for the redirect.
export async function resolveShortLink(shortId: string): Promise<string | null> {
  if (!shortId || shortId.length !== SHORT_ID_LENGTH) return null;
  if (!/^[A-Za-z0-9]+$/.test(shortId)) return null;

  const sb = getAdminClient();
  const { data, error } = await sb
    .from("short_links")
    .select("target_path, expires_at")
    .eq("short_id", shortId)
    .maybeSingle();
  if (error || !data) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) return null;
  return data.target_path as string;
}
