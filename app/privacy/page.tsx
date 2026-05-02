import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How ChiaChat handles your data.",
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-12 text-text">
      <h1 className="text-3xl font-semibold">Privacy Policy</h1>
      <p className="mt-2 text-sm text-muted">Last updated: 2 May 2026</p>

      <section className="mt-8 space-y-3 text-[15px] leading-relaxed">
        <p>
          ChiaChat is a WhatsApp-native Spanish teacher run by Will Graham.
          This policy explains what personal data we collect when you use
          ChiaChat, why we collect it, and the choices you have.
        </p>
      </section>

      <h2 className="mt-10 text-xl font-semibold">What we collect</h2>
      <ul className="mt-3 list-disc list-outside pl-6 space-y-2 text-[15px] leading-relaxed">
        <li>
          <strong>WhatsApp messages</strong> you exchange with Chia, including
          text, voice notes, and any media. We store full message contents to
          deliver the teaching experience and remember context across sessions.
        </li>
        <li>
          <strong>Your WhatsApp number</strong> — used as your account
          identifier. We never display it publicly.
        </li>
        <li>
          <strong>Profile details you share with Chia</strong> — your name,
          native language, learning level, preferences, and anything you choose
          to mention in conversation (job, interests, etc.). Chia uses these to
          personalise lessons.
        </li>
        <li>
          <strong>Lesson progress</strong> — which topics you've completed,
          pronunciation patterns, and learning history.
        </li>
        <li>
          <strong>Payment information</strong> — if you upgrade to Premium, our
          payment processor (Stripe) collects card details. We never see or
          store your card number; we only see a Stripe customer ID.
        </li>
        <li>
          <strong>Usage data</strong> — character counts for voice messages
          (for billing limits), session timestamps, basic technical logs.
        </li>
      </ul>

      <h2 className="mt-10 text-xl font-semibold">How we use it</h2>
      <ul className="mt-3 list-disc list-outside pl-6 space-y-2 text-[15px] leading-relaxed">
        <li>Deliver Spanish teaching through conversation with Chia.</li>
        <li>
          Remember context so Chia can reference your progress and personal
          details naturally.
        </li>
        <li>Process payments and manage subscriptions.</li>
        <li>Send you reminder messages on the schedule you opted into.</li>
        <li>Improve teaching quality (we may review anonymised conversations).</li>
      </ul>

      <h2 className="mt-10 text-xl font-semibold">Third-party processors</h2>
      <p className="mt-3 text-[15px] leading-relaxed">
        ChiaChat relies on several services to deliver the product. They each
        process some of your data on our behalf:
      </p>
      <ul className="mt-3 list-disc list-outside pl-6 space-y-2 text-[15px] leading-relaxed">
        <li>
          <strong>Meta WhatsApp Business Cloud API</strong> — delivers messages
          between your WhatsApp and Chia.
        </li>
        <li>
          <strong>Supabase</strong> — stores your account, lesson progress, and
          conversation context. Hosted in the EU.
        </li>
        <li>
          <strong>OpenAI</strong> — generates Chia's text responses based on
          recent conversation context. Per OpenAI's API terms, conversation
          data is not used to train their models.
        </li>
        <li>
          <strong>ElevenLabs</strong> — converts text to Chia's voice, and
          transcribes your voice notes for pronunciation feedback.
        </li>
        <li>
          <strong>Make.com</strong> — orchestrates the message flow between
          these services.
        </li>
        <li>
          <strong>Stripe</strong> — payment processing for Premium subscriptions.
        </li>
        <li>
          <strong>Vercel</strong> — hosts our admin dashboard and webhook
          endpoints.
        </li>
      </ul>

      <h2 className="mt-10 text-xl font-semibold">Retention</h2>
      <ul className="mt-3 list-disc list-outside pl-6 space-y-2 text-[15px] leading-relaxed">
        <li>
          <strong>Premium users:</strong> we keep your conversation memory
          indefinitely so Chia can build a long-term relationship with you.
        </li>
        <li>
          <strong>Free users:</strong> conversation history older than 7 days
          is summarised and the raw messages are discarded.
        </li>
        <li>
          <strong>If you delete your account:</strong> all your data is removed
          within 30 days.
        </li>
      </ul>

      <h2 className="mt-10 text-xl font-semibold">Your rights (GDPR)</h2>
      <p className="mt-3 text-[15px] leading-relaxed">
        If you are in the EU, EEA, or UK, you have the right to:
      </p>
      <ul className="mt-3 list-disc list-outside pl-6 space-y-2 text-[15px] leading-relaxed">
        <li>Request a copy of your data</li>
        <li>Request deletion of your data</li>
        <li>Correct inaccurate data</li>
        <li>Object to processing</li>
        <li>Withdraw consent at any time</li>
        <li>Lodge a complaint with your local data protection authority</li>
      </ul>
      <p className="mt-3 text-[15px] leading-relaxed">
        To exercise any of these, message <code>STOP</code> or <code>DELETE</code>{" "}
        to Chia, or email us at the address below. We respond within 30 days.
      </p>

      <h2 className="mt-10 text-xl font-semibold">Children</h2>
      <p className="mt-3 text-[15px] leading-relaxed">
        ChiaChat is not directed at children under 16. If you are a parent who
        believes your child has used ChiaChat without consent, contact us and
        we will delete the account.
      </p>

      <h2 className="mt-10 text-xl font-semibold">Changes</h2>
      <p className="mt-3 text-[15px] leading-relaxed">
        We may update this policy occasionally. We will message material
        changes to active users via WhatsApp before they take effect.
      </p>

      <h2 className="mt-10 text-xl font-semibold">Contact</h2>
      <p className="mt-3 text-[15px] leading-relaxed">
        Questions, requests, or complaints? Email{" "}
        <a
          className="text-accent underline underline-offset-2"
          href="mailto:willg1@gmail.com"
        >
          willg1@gmail.com
        </a>
        . We are based in Austria and ChiaChat is operated by Will Graham as a
        sole trader.
      </p>
    </div>
  );
}
