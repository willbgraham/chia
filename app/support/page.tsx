// Public support page for ChiaChat. Linked from Stripe Customer Portal,
// account dashboards, and the homepage footer. Kept intentionally
// simple — students typically reach Chia via WhatsApp first; this
// page is the fallback for billing / account / legal questions
// students can't ask Chia directly.

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Mail, MessageCircle } from "lucide-react";

const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL ?? "support@chiachat.com";
const WHATSAPP_NUMBER =
  process.env.NEXT_PUBLIC_CHIA_WHATSAPP_NUMBER ?? "34600974942";
const WHATSAPP_LINK = `https://wa.me/${WHATSAPP_NUMBER}`;

export const metadata: Metadata = {
  title: "Support",
  description:
    "Contact ChiaChat support. We respond within 1-2 business days.",
};

export default function SupportPage() {
  return (
    <main className="min-h-screen bg-bg text-text">
      <div className="max-w-2xl mx-auto px-6 py-12">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to chiachat.com
        </Link>

        <h1 className="text-3xl font-semibold tracking-tight">
          Support
        </h1>
        <p className="mt-3 text-muted leading-relaxed">
          Hi 🌿 — this is the place for billing questions, account help,
          data deletion requests, and anything else you can&apos;t ask
          Chia directly. We respond within 1-2 business days.
        </p>

        <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="rounded-2xl border border-border bg-surface p-5 hover:border-muted transition-colors"
          >
            <Mail className="h-6 w-6 text-accent mb-3" />
            <div className="text-base font-semibold text-text">Email us</div>
            <div className="mt-1 text-sm text-muted break-all">
              {SUPPORT_EMAIL}
            </div>
          </a>

          <a
            href={WHATSAPP_LINK}
            className="rounded-2xl border border-border bg-surface p-5 hover:border-muted transition-colors"
          >
            <MessageCircle className="h-6 w-6 text-accent mb-3" />
            <div className="text-base font-semibold text-text">
              Chat with Chia
            </div>
            <div className="mt-1 text-sm text-muted">
              For learning questions — your fastest answer
            </div>
          </a>
        </div>

        <div className="mt-10 space-y-6">
          <FAQ
            q="How do I cancel my subscription?"
            a={
              <>
                Open WhatsApp and message Chia the word{" "}
                <strong className="text-text">&quot;account&quot;</strong>.
                She&apos;ll send you a private link to your account where
                you can cancel via Stripe&apos;s secure portal. Cancellation
                takes effect at the end of your current billing period —
                you keep Premium until then.
              </>
            }
          />
          <FAQ
            q="How do I delete my data?"
            a={
              <>
                Email{" "}
                <a
                  className="underline text-text"
                  href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Data deletion request")}`}
                >
                  {SUPPORT_EMAIL}
                </a>{" "}
                from the same address you signed up with, or include your
                WhatsApp number. We&apos;ll delete your account, chat
                memory, and any audio cache linked to your number within
                7 days.
              </>
            }
          />
          <FAQ
            q="My voice notes aren't working — help"
            a={
              <>
                Voice notes are part of Premium (€25/month). On the free
                plan, Chia replies in text only. If you&apos;re on Premium
                and voice still isn&apos;t working, email us at{" "}
                <a
                  className="underline text-text"
                  href={`mailto:${SUPPORT_EMAIL}`}
                >
                  {SUPPORT_EMAIL}
                </a>{" "}
                with the WhatsApp number you signed up with — we&apos;ll
                check the logs.
              </>
            }
          />
          <FAQ
            q="Where is my data stored?"
            a={
              <>
                In the EU. We use Supabase (Frankfurt) for the database
                and Vercel for the application layer. We never sell your
                data, and we never share it with third parties beyond what
                you explicitly opt into (e.g., Stripe for billing,
                ElevenLabs for voice generation, OpenAI for chat
                responses). See{" "}
                <Link href="/privacy" className="underline text-text">
                  the privacy policy
                </Link>{" "}
                for details.
              </>
            }
          />
        </div>

        <div className="mt-12 rounded-2xl border border-border bg-surface p-6 text-sm text-muted">
          <strong className="text-text">ChiaChat</strong> · WhatsApp-native
          Spanish tutoring · Made in Valencia 🌿
          <br />
          Support email: <span className="text-text">{SUPPORT_EMAIL}</span>
        </div>
      </div>
    </main>
  );
}

function FAQ({ q, a }: { q: string; a: React.ReactNode }) {
  return (
    <div>
      <div className="text-base font-semibold text-text">{q}</div>
      <div className="mt-1 text-sm text-muted leading-relaxed">{a}</div>
    </div>
  );
}
