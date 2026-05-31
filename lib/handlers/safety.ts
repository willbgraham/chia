// Safety-pattern detection for sensitive disclosures in free chat.
//
// Chia is an AI Spanish tutor — not a therapist, not a crisis counselor,
// not a domestic-abuse advocate. When a student discloses self-harm,
// abuse, assault, or a workplace-abuse situation, we want a deliberate
// hard-coded response that:
//   1. Acknowledges them warmly (still in Chia's voice, just not in
//      Spanish — clarity matters most in these moments)
//   2. Is honest about what Chia is and isn't equipped to help with
//   3. Points to real resources (region-specific where possible)
//   4. Doesn't pretend to be a counselor or give medical / legal advice
//
// Triggered BEFORE the normal GPT free-chat turn in handleFreeChat —
// so the GPT model never gets a chance to improvise on a sensitive
// disclosure (where it could say something well-meaning but wrong).
//
// Cooldown: once per category per 6 hours per user. Repeated disclosures
// in the same window get a softer "I'm still here for you" follow-up
// instead of the full response every time.

import { sendText } from "@/lib/messaging/whatsapp";
import { getMemory, patchMemory } from "@/lib/handlers/memory";
import { logMessage } from "@/lib/handlers/messages";
import type { MemoryJson } from "@/types";

export type SafetyCategory =
  | "self_harm"
  | "abuse_disclosure"
  | "workplace_abuse"
  | "inappropriate_content";

interface SafetyMatch {
  category: SafetyCategory;
  matched: string;
}

// Detection patterns. Word-boundary anchored where possible to avoid
// false positives (e.g. "abused" matches but "abuser of trust" in a
// Spanish lesson doesn't). Lower-cased input is matched against
// lower-cased patterns.
const PATTERNS: Array<{ category: SafetyCategory; re: RegExp; name: string }> = [
  // Self-harm / suicidal ideation. Strict phrasing required — bare
  // "die" or "kill" alone is too common in casual speech.
  {
    category: "self_harm",
    re: /\b(kill myself|killing myself|end my life|end it all|i want to die|wanna die|hurt myself|hurting myself|self[- ]?harm|cutting myself|take my own life|suicid(e|al))\b/i,
    name: "self_harm",
  },
  // Workplace abuse — specific enough to catch Alex's pattern while
  // avoiding casual usage ("my boss is abusive" in venting).
  {
    category: "workplace_abuse",
    re: /\b(abused? at work|abuse at work|harassed at work|harassment at work|sexually harassed|sexual harassment|workplace (abuse|harassment|assault)|my boss (hit|harassed|assault|abused?))\b/i,
    name: "workplace_abuse",
  },
  // Direct disclosure of past or current abuse / assault — outside
  // workplace context. Domestic violence patterns also caught here.
  {
    category: "abuse_disclosure",
    re: /\b(i was (abused|raped|assaulted|attacked|hit|beaten)|he (hits|beats|hit|beat|raped|assaulted) me|she (hits|beats|hit|beat|raped|assaulted) me|domestic (abuse|violence)|sexual assault|i'?m in danger|i feel unsafe at home)\b/i,
    name: "abuse_disclosure",
  },
  // Inappropriate / sexual content from the user. Triggered by the
  // real Pilij/957c2bff/Alex pattern of treating Chia as a sex
  // chatbot — "send me naked photos", "ilove you" as an opener,
  // "que hermosa eres", etc. Catching these BEFORE the GPT model
  // (and before the free-chat Premium pitch) prevents two ugly
  // outcomes: (1) GPT improvising flirtation, (2) the photo-feature
  // pitch ("photos are Premium €25/mo") landing as a response to a
  // request for nudes — which it actually did for Pilij in the logs.
  // Also see suppressTrialAfterInappropriate in plan.ts: we don't
  // dangle a Premium trial after this fires.
  {
    category: "inappropriate_content",
    re: /\b(send (me )?(your )?(a |the )?(pic|pics|picture|pictures|photo|photos|potos|potos?|fotos?|nudes?|tits|boobs|pussy|booty)|naked|nude pic|sexy (pic|photo|potos|fotos)|all open|allopen|cyber|sext|wanna fuck|let'?s fuck|i love you|ilove you|te amo|mi amor|my love|baby|babe|que hermosa|qué hermosa|que linda|qué linda|you'?re (so )?(beautiful|hot|sexy|gorgeous|fine)|are you single|got a boyfriend|do you have a boyfriend|want to be my girlfriend|wanna be my girlfriend|marry me|kiss me|date me)\b/i,
    name: "inappropriate_content",
  },
];

// Public detector. Returns the first matched category, or null.
export function detectSafetyIssue(message: string): SafetyMatch | null {
  const m = message.toLowerCase();
  for (const p of PATTERNS) {
    if (p.re.test(m)) {
      return { category: p.category, matched: p.name };
    }
  }
  return null;
}

// 6 hours between full safety responses in the same category. Below
// the threshold we still send a brief "I'm still here" follow-up so
// the student feels acknowledged without being spammed with the same
// helplines on every turn.
const COOLDOWN_HOURS = 6;

// Resource sets. UK + US first (the bulk of our ad-driven traffic).
// Includes a global option for everyone else. These are deliberate
// choices — Samaritans is open 24/7, free, accepts texts; ACAS is
// the UK statutory workplace advisor; EEOC handles US workplace
// harassment/discrimination claims; the Hotline is the largest US
// DV resource. Update if you serve a different geography.

const SELF_HARM_RESPONSE = (name: string | null): string =>
  `${name ? `${name}, ` : ""}what you just shared sounds really heavy 🌿 I want to be honest with you — I'm an AI Spanish tutor, and a situation this serious deserves a real human who's trained to help.

Please reach out to someone right now:

🇬🇧 *Samaritans* — call 116 123 (free, 24/7) or text SHOUT to 85258
🇺🇸 *988* — call or text 988 (Suicide & Crisis Lifeline, 24/7)
🌍 findahelpline.com — pick your country

You don't have to be in crisis to call them. They listen.

I'm here whenever you want to come back and chat about Spanish. ❤️`;

const ABUSE_DISCLOSURE_RESPONSE = (name: string | null): string =>
  `${name ? `${name}, ` : ""}I'm really sorry that happened to you 🌿 — and I want to be honest, I'm an AI Spanish tutor, not someone trained to support you through this. You deserve real, expert support.

Some places that can help:

🇬🇧 *Refuge* — 0808 2000 247 (National Domestic Abuse Helpline, free 24/7)
🇬🇧 *Rape Crisis* — 0808 500 2222 (free, 24/7)
🇺🇸 *National DV Hotline* — 1-800-799-7233 or text START to 88788
🇺🇸 *RAINN* — 1-800-656-4673 (sexual assault)
🌍 findahelpline.com — by country

You can also reach out to a doctor, a friend you trust, or local police if you're in immediate danger.

I'm here when you want to come back and chat. ❤️`;

const WORKPLACE_ABUSE_RESPONSE = (name: string | null): string =>
  `${name ? `${name}, ` : ""}that sounds difficult, and I'm sorry it's happening 🌿 I want to be honest with you — I'm an AI Spanish tutor, so I'm not the right place for proper advice on this. There are people who specialize in workplace issues and will take it seriously.

Some places that can help:

🇬🇧 *ACAS* — 0300 123 1100 (free workplace advice, including bullying & harassment)
🇬🇧 *Citizens Advice* — citizensadvice.org.uk
🇺🇸 *EEOC* — 1-800-669-4000 (workplace harassment & discrimination)
🇺🇸 Your HR department or an employment lawyer

If you've already filed a complaint, that's a real step forward 🌿 — keep records of everything.

I'm here when you want to come back and chat. ❤️`;

// Inappropriate-content deflection. Crucially does NOT mention the
// Premium price tag — pitching "€25/month and I'll send photos" in
// response to "send me naked photos" is the bug we're fixing. Warm
// but firm, names the misunderstanding, redirects to learning.
const INAPPROPRIATE_RESPONSE = (name: string | null): string =>
  `Eyyy ${name ?? "amig@"} 😅 soy tu profesora de español, no una novia virtual.

If you want me to teach you words for "hello", "I'm hungry", how to order in a restaurant, or how to flirt in Spanish *properly* (that's actually fun) — sí, hablamos. 🌿

If you want anything else — that's not what I do. Volvamos al español, ¿vale?

*(I'm your Spanish teacher, not a virtual girlfriend — let's get back to Spanish, okay?)*`;

const SOFT_FOLLOWUP = (name: string | null): string =>
  `I hear you ${name ?? ""}🌿 I still think reaching out to someone trained to help is the right move — the resources I shared earlier are open 24/7. I'm here whenever you want to chat about Spanish. ❤️`;

interface RespondArgs {
  userId: string;
  whatsappNumber: string;
  userMessage: string;
  match: SafetyMatch;
}

// Send the safety response (or soft follow-up if within cooldown).
// Returns true so the caller knows to skip the normal GPT free-chat
// turn entirely on this inbound message.
export async function respondToSafetyIssue(args: RespondArgs): Promise<true> {
  const memory = await getMemory(args.userId);
  const name = memory.name ?? null;

  const safetyState = ((memory as { safety_state?: Record<string, string> })
    .safety_state ?? {}) as Record<string, string>;
  const lastIso = safetyState[args.match.category];

  // Inappropriate-content gets a shorter cooldown (1h) — the
  // deflection should land freshly each time someone tests, but
  // we don't want to spam it every turn either. Other categories
  // keep the full 6h.
  const effectiveCooldownHours =
    args.match.category === "inappropriate_content" ? 1 : COOLDOWN_HOURS;
  const withinShortCooldown =
    lastIso &&
    Date.now() - new Date(lastIso).getTime() <
      effectiveCooldownHours * 60 * 60 * 1000;

  const reply = withinShortCooldown
    ? args.match.category === "inappropriate_content"
      ? `${name ? `${name}, ` : ""}still here to teach Spanish 🌿 ¿Qué quieres aprender?`
      : SOFT_FOLLOWUP(name)
    : args.match.category === "self_harm"
      ? SELF_HARM_RESPONSE(name)
      : args.match.category === "abuse_disclosure"
        ? ABUSE_DISCLOSURE_RESPONSE(name)
        : args.match.category === "workplace_abuse"
          ? WORKPLACE_ABUSE_RESPONSE(name)
          : INAPPROPRIATE_RESPONSE(name);

  await sendText(args.whatsappNumber, reply);

  // Persist the cooldown timestamp + log both the trigger and the
  // response. The trigger log is important: it's the auditable record
  // that we DID see a disclosure and responded appropriately, so if
  // anyone ever audits the system we can show our safety handling.
  await patchMemory(args.userId, {
    safety_state: {
      ...safetyState,
      [args.match.category]: new Date().toISOString(),
    },
  } as Partial<MemoryJson>);

  await logMessage({
    userId: args.userId,
    role: "user",
    content: `[safety:${args.match.category}] ${args.userMessage}`,
  });
  await logMessage({
    userId: args.userId,
    role: "assistant",
    content: `[safety-response] ${reply.slice(0, 200)}...`,
  });

  return true;
}
