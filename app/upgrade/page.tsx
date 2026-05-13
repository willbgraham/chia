// Branded /upgrade landing page. Replaces the bare Stripe Payment Link
// as the destination for Chia's "want premium?" links and any
// future paid-traffic landing destinations.
//
// Two ways the URL is hit:
//   /upgrade               (anonymous — homepage / ad clicks)
//   /upgrade?ref=<userId>  (signed by Chia in WhatsApp; passes through
//                           to Stripe's client_reference_id so the
//                           webhook flips the right user to premium)

import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Check } from "lucide-react";
import { getAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Upgrade to Premium",
  description:
    "Hear Chia's voice, get pronunciation feedback, see contextual photos. €25/month, cancel anytime.",
};

const STRIPE_LINK = process.env.STRIPE_PREMIUM_PAYMENT_LINK ?? "";
const WHATSAPP_NUMBER =
  process.env.NEXT_PUBLIC_CHIA_WHATSAPP_NUMBER ?? "34600974942";
const WHATSAPP_LINK = `https://wa.me/${WHATSAPP_NUMBER}`;

interface ChiaInfo {
  name: string;
  profile_image_url: string | null;
}

async function fetchChia(): Promise<ChiaInfo | null> {
  try {
    const sb = getAdminClient();
    const { data } = await sb
      .from("teachers")
      .select("name, profile_image_url")
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .single();
    return (data as ChiaInfo | null) ?? null;
  } catch {
    return null;
  }
}

// Compose the Stripe checkout link with optional client_reference_id
// (so the webhook flips the right user to premium) and optional
// prefilled promo code (so a launch discount auto-applies without the
// student having to type it).
//
// Promo precedence: ?promo= URL param wins over env default, so per-
// link overrides ("LAUNCH50" vs "WINBACK20") are possible by sending
// a different link in Chia's message.
function buildStripeLink(
  ref: string | undefined,
  promoOverride: string | undefined,
): string {
  if (!STRIPE_LINK) return "#";
  const params: string[] = [];
  if (ref) params.push(`client_reference_id=${encodeURIComponent(ref)}`);
  const promo = promoOverride ?? process.env.STRIPE_PREFILLED_PROMO_CODE ?? "";
  if (promo) {
    params.push(`prefilled_promo_code=${encodeURIComponent(promo)}`);
  }
  if (params.length === 0) return STRIPE_LINK;
  const sep = STRIPE_LINK.includes("?") ? "&" : "?";
  return `${STRIPE_LINK}${sep}${params.join("&")}`;
}

export default async function UpgradePage({
  searchParams,
}: {
  searchParams: { ref?: string; promo?: string };
}) {
  const chia = await fetchChia();
  const checkoutUrl = buildStripeLink(searchParams.ref, searchParams.promo);

  return (
    <main className="min-h-screen bg-bg text-text">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to chiachat.com
        </Link>

        {/* ── Hero ──────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] items-start gap-6">
          <div>
            <p className="text-sm uppercase tracking-[0.18em] text-accent mb-3">
              Premium
            </p>
            <h1 className="text-4xl md:text-5xl font-semibold tracking-tight leading-tight">
              Hear my voice.
              <br />
              <span className="text-accent">Speak Spanish back.</span>
            </h1>
            <p className="mt-5 text-lg text-muted leading-relaxed">
              Free is text-only — fine for picking up vocab. Premium is
              where Spanish actually starts to live in your ears and
              mouth: voice notes from me, pronunciation feedback when
              you record yourself, and the occasional photo from
              Valencia 🌿
            </p>
          </div>
          {chia?.profile_image_url ? (
            <div className="relative h-28 w-28 sm:h-36 sm:w-36 rounded-3xl overflow-hidden bg-surface border border-border shrink-0 self-start sm:self-center">
              <Image
                src={chia.profile_image_url}
                alt={chia.name}
                fill
                priority
                sizes="144px"
                className="object-cover"
              />
            </div>
          ) : null}
        </div>

        {/* ── Price + CTA ──────────────────────────────── */}
        <div className="mt-12 rounded-3xl border border-accent/40 bg-accent/10 p-8">
          <div className="flex items-baseline gap-2">
            <span className="text-5xl font-semibold text-text">€25</span>
            <span className="text-lg text-muted">/month</span>
          </div>
          <div className="mt-1 text-sm text-muted">
            Cancel anytime · No long-term contract · Card or Apple Pay
          </div>

          <ul className="mt-6 space-y-3">
            <Feature text="Voice notes from Chia in real Spanish" />
            <Feature text="Pronunciation feedback on your voice messages" />
            <Feature text="Contextual photos from Valencia mid-chat" />
            <Feature text="Unlimited daily messages (free is capped)" />
            <Feature text="Priority responses + new features first" />
            <Feature text="Cancel from your account in two clicks" />
          </ul>

          <a
            href={checkoutUrl}
            data-track="InitiateCheckout"
            data-track-label="upgrade-page"
            className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-full bg-accent text-bg px-6 py-4 text-base font-semibold hover:opacity-90 transition-opacity"
          >
            Upgrade to Premium
          </a>

          <p className="mt-4 text-xs text-muted text-center">
            Payment handled securely by Stripe. We never see your card.
          </p>
        </div>

        {/* ── Comparison ───────────────────────────────── */}
        <div className="mt-16">
          <h2 className="text-2xl font-semibold tracking-tight">
            What changes
          </h2>
          <div className="mt-5 grid grid-cols-2 gap-4">
            <div className="rounded-2xl border border-border bg-surface p-5">
              <div className="text-xs uppercase tracking-wide text-muted">
                Free
              </div>
              <ul className="mt-3 space-y-2 text-sm text-text">
                <li>• Daily Spanish chat with Chia</li>
                <li>• English translations under every reply</li>
                <li>• Phonetic pronunciation in brackets</li>
                <li>• Streak tracking + reminders</li>
                <li>• 50 messages/day cap</li>
              </ul>
            </div>
            <div className="rounded-2xl border border-accent/40 bg-accent/10 p-5">
              <div className="text-xs uppercase tracking-wide text-accent">
                Premium
              </div>
              <ul className="mt-3 space-y-2 text-sm text-text">
                <li>
                  • Everything in Free, plus —
                </li>
                <li>• 🎵 Chia speaks the phrases aloud</li>
                <li>• 🎙️ Pronunciation correction on your voice notes</li>
                <li>• 📸 Photos from Valencia mid-conversation</li>
                <li>• 500 messages/day soft cap (essentially unlimited)</li>
              </ul>
            </div>
          </div>
        </div>

        {/* ── FAQ ──────────────────────────────────────── */}
        <div className="mt-16 space-y-6">
          <h2 className="text-2xl font-semibold tracking-tight">FAQ</h2>
          <FAQ
            q="How do I cancel?"
            a="Two ways: text Chia 'cancel' on WhatsApp and she'll send you a private link to your account, or visit chiachat.com/account directly. You stay Premium until the end of the month you've paid for."
          />
          <FAQ
            q="What if I'm in a country where €25 is a lot?"
            a="Email support@chiachat.com — we run a regional pricing program. Mention your country and we'll reply with a discount link."
          />
          <FAQ
            q="Do I need to install anything?"
            a="No app, ever. Everything happens in your existing WhatsApp."
          />
          <FAQ
            q="Where's my data?"
            a="In the EU (Frankfurt). We never sell it, never share it beyond what's required to deliver the service. Email support@chiachat.com to delete your account at any time."
          />
        </div>

        {/* ── Bottom CTA ──────────────────────────────── */}
        <div className="mt-16 rounded-3xl border border-border bg-surface p-8 text-center">
          <p className="text-lg text-text">
            Still on the fence? Keep chatting with me on free —
            <br className="hidden sm:block" /> upgrade when you&apos;re
            ready to hear my voice.
          </p>
          <a
            href={WHATSAPP_LINK}
            data-track="Lead"
            data-track-label="upgrade-page-back-to-whatsapp"
            className="mt-5 inline-flex items-center gap-2 rounded-full border border-border bg-bg px-5 py-2.5 text-sm text-text hover:border-muted"
          >
            Back to chatting with Chia
          </a>
        </div>
      </div>
    </main>
  );
}

function Feature({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-3 text-sm text-text">
      <Check className="h-4 w-4 text-accent shrink-0 mt-0.5" />
      <span className="leading-relaxed">{text}</span>
    </li>
  );
}

function FAQ({ q, a }: { q: string; a: string }) {
  return (
    <div>
      <div className="text-base font-semibold text-text">{q}</div>
      <div className="mt-1 text-sm text-muted leading-relaxed">{a}</div>
    </div>
  );
}
