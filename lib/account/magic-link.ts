// Magic-link auth for the student account dashboard at /account/<token>.
// Students live in WhatsApp — they don't have email/password — so when
// Chia sends them a "manage your account" link, the URL itself carries
// proof of identity via an HMAC-signed token.
//
// Token format: base64url(<userId>.<expiryUnix>.<hmacBase64url>)
// Single-line, URL-safe, ~120 chars.
//
// Security model: the token is a bearer credential. Anyone with it has
// access to that student's account for 24h. That's acceptable because
// (a) the token is delivered via WhatsApp on the student's own phone,
// (b) WhatsApp messages are end-to-end encrypted, (c) the token expires.
// If a token leaks, the attacker can see the user's plan + cancel
// their subscription via Stripe Portal — but not steal payment methods
// (that's gated by Stripe's own re-auth) or change credentials (we
// don't have any).

import crypto from "crypto";

const TTL_HOURS = 24;
const ALG = "sha256";

function getSecret(): string {
  const secret = process.env.MAGIC_LINK_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "MAGIC_LINK_SECRET is missing or too short (need ≥32 chars)",
    );
  }
  return secret;
}

// Constant-time string comparison via crypto.timingSafeEqual on equal
// length buffers. Returns false on any error or length mismatch.
function timingSafeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  try {
    return crypto.timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

function sign(payload: string, secret: string): string {
  return crypto.createHmac(ALG, secret).update(payload).digest("base64url");
}

export function signAccountToken(userId: string): string {
  const secret = getSecret();
  const expiry = Math.floor(Date.now() / 1000) + TTL_HOURS * 3600;
  const payload = `${userId}.${expiry}`;
  const sig = sign(payload, secret);
  // Stuff payload + signature into a single URL-safe string. The outer
  // base64url encoding lets us put it in a path component without any
  // weirdness around dots.
  return Buffer.from(`${payload}.${sig}`).toString("base64url");
}

export interface VerifiedToken {
  userId: string;
  expiresAt: number; // unix seconds
}

export function verifyAccountToken(token: string): VerifiedToken | null {
  if (!token || token.length > 500) return null;
  let secret: string;
  try {
    secret = getSecret();
  } catch {
    return null;
  }

  let decoded: string;
  try {
    decoded = Buffer.from(token, "base64url").toString("utf-8");
  } catch {
    return null;
  }

  const parts = decoded.split(".");
  if (parts.length !== 3) return null;
  const [userId, expiryStr, sig] = parts;

  const expiry = Number.parseInt(expiryStr, 10);
  if (!userId || !Number.isFinite(expiry) || !sig) return null;
  if (expiry * 1000 < Date.now()) return null; // expired

  const expectedSig = sign(`${userId}.${expiry}`, secret);
  if (!timingSafeEquals(sig, expectedSig)) return null;

  return { userId, expiresAt: expiry };
}

// Convenience: build the full URL Chia sends in WhatsApp.
export function accountUrl(userId: string): string {
  const token = signAccountToken(userId);
  const base =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://chiachat.com";
  return `${base.replace(/\/+$/, "")}/account/${token}`;
}
