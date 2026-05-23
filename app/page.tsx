// Public homepage at chiachat.com. Server component — fetches Chia's
// row directly from Supabase so the photo + backstory stay in sync
// with whatever the admin sets in /admin/teachers/<id>.

import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { getAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const revalidate = 60; // cache the home page for 1 min

export const metadata: Metadata = {
  title: "ChiaChat — Chat your way to fluency in Spanish",
  description:
    "Learn Spanish by chatting with Chia, a 27-year-old from Valencia, on WhatsApp. No textbooks. No classrooms. Just conversation.",
};

const WHATSAPP_NUMBER =
  process.env.NEXT_PUBLIC_CHIA_WHATSAPP_NUMBER ?? "436606412569";
const WHATSAPP_LINK = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent("Hola Chia 🌿")}`;

interface ChiaTeacher {
  name: string;
  age: number | null;
  nationality: string | null;
  profile_image_url: string | null;
  backstory: string | null;
}

async function fetchChia(): Promise<ChiaTeacher | null> {
  try {
    const sb = getAdminClient();
    const { data } = await sb
      .from("teachers")
      .select("name, age, nationality, profile_image_url, backstory")
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .single();
    return (data as ChiaTeacher | null) ?? null;
  } catch {
    return null;
  }
}

// JSON-LD structured data. Three schemas inline below: Organization
// (anchors the brand), Service (the Premium product), and FAQPage
// (eligible for the rich-result Q&A block in Google search results).
// All keys come from schema.org — see https://schema.org/Organization,
// /Service, /FAQPage. Validate at https://validator.schema.org if
// adding fields.
function buildStructuredData(): string {
  const site =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://chiachat.com";
  const wa =
    process.env.NEXT_PUBLIC_CHIA_WHATSAPP_NUMBER ?? "436606412569";

  const schemas = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "ChiaChat",
      url: site,
      logo: `${site}/icon.svg`,
      description:
        "Spanish language learning via WhatsApp chat with an AI tutor.",
      contactPoint: {
        "@type": "ContactPoint",
        contactType: "customer support",
        url: `https://wa.me/${wa}`,
        availableLanguage: ["English", "Spanish"],
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "Service",
      serviceType: "Spanish language tutoring",
      provider: { "@type": "Organization", name: "ChiaChat" },
      areaServed: "Worldwide",
      audience: { "@type": "Audience", audienceType: "Spanish language learners" },
      description:
        "Daily Spanish conversation practice with Chia, a teacher from Valencia. Lessons, audio, voice-note pronunciation feedback, structured curriculum from A1 through C1, all on WhatsApp.",
      offers: [
        {
          "@type": "Offer",
          name: "Free",
          price: "0",
          priceCurrency: "EUR",
          description:
            "Daily Spanish chat, structured curriculum, pop quizzes, streak tracking.",
        },
        {
          "@type": "Offer",
          name: "Premium (monthly)",
          price: "25",
          priceCurrency: "EUR",
          priceSpecification: {
            "@type": "UnitPriceSpecification",
            price: "25",
            priceCurrency: "EUR",
            unitCode: "MON",
          },
          description:
            "Everything in Free plus voice notes from Chia, pronunciation correction, contextual photos, PDF cheat sheets, long-term memory, 500 messages/day.",
        },
        {
          "@type": "Offer",
          name: "Premium (annual)",
          price: "200",
          priceCurrency: "EUR",
          description: "All Premium features, billed annually — saves €100/year.",
        },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "Do I need to install an app to use ChiaChat?",
          acceptedAnswer: {
            "@type": "Answer",
            text:
              "No. ChiaChat runs entirely inside WhatsApp — the app you already have. Tap the link, say hola, and you're learning.",
          },
        },
        {
          "@type": "Question",
          name: "Is ChiaChat free?",
          acceptedAnswer: {
            "@type": "Answer",
            text:
              "Yes, the free tier includes daily Spanish chat with Chia, English translations under every reply, a structured curriculum from A1 to C1, pop quizzes, and streak tracking. Premium (€25/month or €200/year) adds voice notes, pronunciation correction, contextual photos and PDFs.",
          },
        },
        {
          "@type": "Question",
          name: "What level of Spanish do I need to start?",
          acceptedAnswer: {
            "@type": "Answer",
            text:
              "Any level — Chia adapts to you. The structured curriculum covers A1 (beginner) through C1 (advanced) with 84 lessons across 28 modules. Chia replies in Spanish then English so you always know what she said.",
          },
        },
        {
          "@type": "Question",
          name: "Can I cancel Premium at any time?",
          acceptedAnswer: {
            "@type": "Answer",
            text:
              "Yes. Subscriptions cancel anytime from your account page or by messaging Chia 'cancel'. You keep premium access until the end of the billing period.",
          },
        },
      ],
    },
  ];
  // Escape "<" so a stray "</script>" in any value (now or in a
  // future edit) can't break out of the inline JSON-LD <script> tag.
  // < is a valid JSON sequence + safe inside a script body.
  return JSON.stringify(schemas).replace(/</g, "\\u003c");
}

export default async function Home() {
  const chia = await fetchChia();
  const jsonLd = buildStructuredData();

  return (
    <main className="min-h-screen bg-bg text-text">
      {/* JSON-LD structured data — emits as inline <script> with
          application/ld+json type, the format Google + Bing parse
          for rich-result eligibility. */}
      <script
        type="application/ld+json"
        // Safe: content is built server-side from constants + env vars,
        // no user input. JSON.stringify never produces </script>
        // sequences from these inputs.
        dangerouslySetInnerHTML={{ __html: jsonLd }}
      />
      {/* ─── Header ─────────────────────────────────────────────── */}
      <header className="max-w-6xl mx-auto px-6 pt-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BrandMark size={32} src={chia?.profile_image_url ?? null} />
          <span className="font-semibold tracking-tight">ChiaChat</span>
        </div>
        <a
          href={WHATSAPP_LINK}
          className="text-sm text-muted hover:text-text"
          data-track="Lead"
          data-track-label="header-link"
        >
          Chat with Chia →
        </a>
      </header>

      {/* ─── Hero ───────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 pt-12 pb-20 grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-12 items-center">
        <div>
          <p className="text-sm uppercase tracking-[0.18em] text-accent mb-4">
            Spanish, by WhatsApp
          </p>
          <h1 className="text-5xl md:text-6xl font-semibold leading-[1.05] tracking-tight">
            Aprende español
            <br />
            <span className="text-accent">talking to a friend</span>.
          </h1>
          <p className="mt-6 text-lg text-muted max-w-xl leading-relaxed">
            ChiaChat puts you in conversation with{" "}
            <strong className="text-text">Chia</strong>, a 27-year-old teacher
            from Valencia. She replies in Spanish, then in English, so you pick
            it up the way you'd pick up a language from a friend — by being
            around her. Live, on WhatsApp. The only app you already use.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-4">
            <a
              href={WHATSAPP_LINK}
              className="inline-flex items-center gap-2 rounded-full bg-accent text-bg px-6 py-3 text-sm font-semibold hover:opacity-90 transition-opacity"
              data-track="Lead"
              data-track-label="hero-cta"
            >
              <WhatsAppGlyph />
              Start chatting on WhatsApp
            </a>
            <span className="text-sm text-muted">
              Free to try · €25/month for voice
            </span>
          </div>

          <p className="mt-6 text-xs text-muted">
            We&apos;ll text you within a minute. No app to install — just open
            WhatsApp.
          </p>
        </div>

        <div className="relative">
          <div className="relative aspect-square rounded-3xl overflow-hidden bg-surface border border-border max-w-md mx-auto">
            {chia?.profile_image_url ? (
              <Image
                src={chia.profile_image_url}
                alt={chia.name}
                fill
                priority
                sizes="(max-width: 1024px) 100vw, 480px"
                className="object-cover"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-7xl">
                🌿
              </div>
            )}
          </div>
          <div className="mt-4 text-center text-sm text-muted">
            <span className="font-semibold text-text">
              {chia?.name ?? "Chia"}
            </span>
            {chia?.age ? ` · ${chia.age}` : ""} · Valencia, Spain
          </div>
        </div>
      </section>

      {/* ─── How it works ───────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-border">
        <h2 className="text-3xl font-semibold tracking-tight">
          How it works
        </h2>
        <p className="mt-2 text-muted">
          No setup. No homework. You text. She texts back. That&apos;s it.
        </p>

        <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-6">
          <Step
            n="1"
            title="Send a hola"
            body="Tap the button above and say hi on WhatsApp. Chia onboards you in three minutes — name, level, what you want to learn."
          />
          <Step
            n="2"
            title="Chat about anything"
            body="Tell her about your day. Ask how to flirt in Spanish. Argue about football. She replies in Spanish, then in English so you always know what she said."
          />
          <Step
            n="3"
            title="Hear her voice"
            body="Send a voice note pronouncing a word — she'll send one back, gentle correction included. (Premium plan unlocks unlimited voice.)"
          />
        </div>
      </section>

      {/* ─── About Chia ─────────────────────────────────────────── */}
      {chia?.backstory ? (
        <section className="max-w-6xl mx-auto px-6 py-20 border-t border-border">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-10 items-start">
            <h2 className="text-3xl font-semibold tracking-tight">
              About Chia
            </h2>
            <p className="text-lg text-muted leading-relaxed">
              {chia.backstory}
            </p>
          </div>
        </section>
      ) : null}

      {/* ─── Pricing ────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-border">
        <h2 className="text-3xl font-semibold tracking-tight">Pricing</h2>
        <p className="mt-2 text-muted">
          Start free. Upgrade when you&apos;re ready to hear her speak.
        </p>

        <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-6">
          <PricingCard
            name="Free"
            price="€0"
            tagline="Chat with Chia, every day"
            features={[
              "Daily Spanish chat with Chia",
              "Translations in English under every reply",
              "Structured curriculum (A1→B1, 10 modules, 39 lessons)",
              "Pop quizzes via WhatsApp polls",
              "Streak tracking + reminders",
            ]}
            cta="Start free"
            href={WHATSAPP_LINK}
            primary={false}
          />
          <PricingCard
            name="Premium"
            price="€25"
            priceSuffix="/month or €200/year"
            tagline="Hear her voice. See her photos. Speak Spanish back."
            features={[
              "Everything in Free, plus —",
              "🎵 Voice notes from Chia in Spanish",
              "🎙️ Pronunciation correction (slow playback to mimic)",
              "📸 Photos from Valencia mid-conversation",
              "📄 PDF cheat sheets (conjugations, vocab, pickup lines)",
              "🧠 Long-term memory across conversations",
              "500 messages/day (essentially unlimited)",
              "Cancel anytime",
            ]}
            cta="Chat first, upgrade later"
            href={WHATSAPP_LINK}
            primary={true}
          />
        </div>
        <p className="mt-6 text-sm text-muted text-center">
          Annual saves €100/year. See full details at{" "}
          <Link href="/upgrade" className="underline text-text hover:opacity-80">
            chiachat.com/upgrade
          </Link>
          .
        </p>
      </section>

      {/* ─── Footer ─────────────────────────────────────────────── */}
      <footer className="border-t border-border">
        <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 text-sm text-muted">
          <div className="flex items-center gap-2">
            <BrandMark size={28} src={chia?.profile_image_url ?? null} />
            <span>ChiaChat — Made in Valencia</span>
          </div>
          <div className="flex items-center gap-6">
            <Link href="/upgrade" className="hover:text-text">
              Premium
            </Link>
            <Link href="/support" className="hover:text-text">
              Support
            </Link>
            <Link href="/privacy" className="hover:text-text">
              Privacy
            </Link>
            <a
              href={WHATSAPP_LINK}
              className="hover:text-text"
              data-track="Lead"
              data-track-label="footer-link"
            >
              Chat with Chia
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}

// ── Bits ─────────────────────────────────────────────────────────

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-6">
      <div className="text-accent font-mono text-sm">{n}</div>
      <div className="mt-2 text-lg font-semibold text-text">{title}</div>
      <p className="mt-2 text-sm text-muted leading-relaxed">{body}</p>
    </div>
  );
}

function PricingCard({
  name,
  price,
  priceSuffix,
  tagline,
  features,
  cta,
  href,
  primary,
}: {
  name: string;
  price: string;
  priceSuffix?: string;
  tagline: string;
  features: string[];
  cta: string;
  href: string;
  primary: boolean;
}) {
  // Lead-tracking label keys ad analytics on which pricing tile drove
  // the click — "free-cta" vs "premium-cta".
  const trackLabel = primary ? "premium-cta" : "free-cta";
  return (
    <div
      className={
        primary
          ? "rounded-2xl bg-accent/10 border border-accent/40 p-8"
          : "rounded-2xl border border-border bg-surface p-8"
      }
    >
      <div className="flex items-baseline justify-between">
        <div className="text-lg font-semibold text-text">{name}</div>
        <div>
          <span className="text-3xl font-semibold text-text">{price}</span>
          {priceSuffix ? (
            <span className="text-sm text-muted">{priceSuffix}</span>
          ) : null}
        </div>
      </div>
      <div className="mt-1 text-sm text-muted">{tagline}</div>
      <ul className="mt-6 space-y-2">
        {features.map((f) => (
          <li
            key={f}
            className="flex items-start gap-2 text-sm text-text leading-relaxed"
          >
            <span className="text-accent mt-0.5">·</span>
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <a
        href={href}
        data-track="Lead"
        data-track-label={trackLabel}
        className={
          "mt-8 inline-flex w-full items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition-opacity " +
          (primary
            ? "bg-accent text-bg hover:opacity-90"
            : "border border-border text-text hover:border-muted")
        }
      >
        <WhatsAppGlyph />
        {cta}
      </a>
    </div>
  );
}

// Small circular avatar used in the header + footer in place of the
// old leaf emoji. Falls back to the leaf if no photo is set so the
// brand mark never breaks even before an admin uploads.
function BrandMark({ src, size }: { src: string | null; size: number }) {
  if (!src) {
    return (
      <span style={{ fontSize: Math.round(size * 0.7), lineHeight: 1 }}>
        🌿
      </span>
    );
  }
  return (
    <span
      className="rounded-full overflow-hidden bg-surface border border-border inline-block shrink-0"
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Chia"
        className="h-full w-full object-cover"
      />
    </span>
  );
}

function WhatsAppGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M19.05 4.91A9.82 9.82 0 0 0 12.04 2c-5.46 0-9.91 4.45-9.91 9.91a9.85 9.85 0 0 0 1.32 4.95L2.05 22l5.25-1.38a9.86 9.86 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.91-7.01zM12.05 20.15h-.01a8.22 8.22 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.18 8.18 0 0 1-1.26-4.39c0-4.54 3.7-8.23 8.24-8.23 2.2 0 4.27.86 5.83 2.41a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.24-8.23 8.24zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.12-.16.25-.64.81-.79.97-.15.16-.29.18-.54.06-.25-.12-1.05-.39-2-1.23a7.5 7.5 0 0 1-1.39-1.72c-.14-.25-.02-.38.11-.5.11-.11.25-.29.37-.43.13-.14.16-.25.25-.41.08-.16.04-.31-.02-.43-.06-.12-.55-1.34-.76-1.83-.2-.48-.4-.42-.55-.43-.14-.01-.31-.01-.47-.01a.91.91 0 0 0-.66.31c-.23.25-.86.84-.86 2.05 0 1.21.88 2.38 1 2.54.12.16 1.74 2.66 4.22 3.73.59.26 1.05.41 1.41.52.59.19 1.13.16 1.55.1.47-.07 1.47-.6 1.68-1.18.21-.59.21-1.09.14-1.18-.06-.1-.22-.16-.47-.28z" />
    </svg>
  );
}
