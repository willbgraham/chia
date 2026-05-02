# ChiaChat — WhatsApp-native AI language learning

ChiaChat teaches Spanish through WhatsApp. The student texts a number,
gets warm conversational replies from **Chia** (the AI teacher),
hears Chia speak via voice notes, and gets pronunciation feedback
on their own voice notes — all inside WhatsApp.

This repo contains:

- The **admin dashboard** (Next.js 14 App Router) — for managing
  teachers, images, lessons, users.
- Two **webhook routes** — `/api/webhooks/stripe` (plan upgrade) and
  `/api/webhooks/elevenlabs` (post-voice-exchange bridge).
- The **database schema** (`supabase/schema.sql`) and **seed data**
  (`supabase/seed.sql`) for Chia and 5 starter Spanish lessons.

It does **not** contain the runtime conversation engine — that lives
in Make.com (text loop) and ElevenLabs Conversational Agent (voice
loop). See [MAKE_SCENARIOS.md](./MAKE_SCENARIOS.md) for the full
specification of every Make scenario.

## Architecture at a glance

```
                ┌────────────┐
   user 📱 ──── │  WhatsApp  │
                └─────┬──────┘
                      │ Meta WhatsApp Cloud API
                      │
        text msg ─────┼───── audio msg
                      │
       ┌──────────────┴──────────────┐
       │                             │
  ┌────▼─────┐                  ┌────▼──────────────────┐
  │ Make.com │                  │ ElevenLabs Conv.Agent │
  │ scenarios│                  │ (STT + Chia voice)   │
  └────┬─────┘                  └────┬──────────────────┘
       │                             │
       │  read/write                 │  POST after each
       │                             │  voice exchange
       │                             │
       └──────────► Supabase ◄───────┘
                      ▲
                      │
              ┌───────┴────────┐
              │ Next.js admin  │  (this repo)
              │ + webhooks     │
              └────────────────┘
```

## Environment variables

Copy `.env.local.example` to `.env.local` and fill in.

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public client key (admin login) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** — used by every server-side write |
| `SUPABASE_STORAGE_BUCKET` | Defaults to `chiachat-media` |
| `STRIPE_SECRET_KEY` | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | Stripe → us signing secret |
| `STRIPE_PREMIUM_PAYMENT_LINK` | Pre-built Payment Link URL |
| `OPENAI_API_KEY` | Used by Make.com (kept here for reference) |
| `ELEVENLABS_API_KEY` | Outbound TTS calls from Make |
| `ELEVENLABS_CHIA_VOICE_ID` | Chia's voice in ElevenLabs |
| `ELEVENLABS_AGENT_ID` | Conversational Agent ID (voice loop) |
| `ELEVENLABS_WEBHOOK_SECRET` | Shared secret for `/api/webhooks/elevenlabs` |
| `META_WHATSAPP_ACCESS_TOKEN` | Long-lived system user token for Meta Cloud API |
| `META_WHATSAPP_PHONE_NUMBER_ID` | Numeric ID of the WhatsApp number (used in API URLs) |
| `META_WHATSAPP_BUSINESS_ACCOUNT_ID` | WABA ID that owns the number |
| `META_WHATSAPP_VERIFY_TOKEN` | Random string echoed back during webhook setup |
| `META_WHATSAPP_APP_SECRET` | Meta App secret — verifies inbound webhook signatures |
| `META_WHATSAPP_NUMBER` | The actual phone number in E.164 format (display only) |
| `MAKE_STRIPE_REACTIVATION_WEBHOOK_URL` | Make webhook fired after Stripe upgrade |
| `ADMIN_EMAIL` | The single email permitted to log in to `/admin` |

## First-run checklist

1. **Supabase project**
   1. Create a new project at [supabase.com](https://supabase.com).
   2. SQL editor → run `supabase/schema.sql`.
   3. SQL editor → run `supabase/storage.sql`.
   4. SQL editor → run `supabase/seed.sql` (inserts Chia + 5 lessons).
   5. Settings → API → copy URL, anon key, service role key into `.env.local`.
   6. Authentication → Users → add an admin user with the same email
      as `ADMIN_EMAIL`. Set a password.
2. **Meta WhatsApp Cloud API**
   1. Go to [developers.facebook.com](https://developers.facebook.com),
      create a new App (type **Business**), add the **WhatsApp** product.
   2. The setup wizard will provision a free test number immediately and
      let you start a Meta Business Manager → WhatsApp Business Account
      (WABA). Add your real phone number to the WABA and verify it via
      SMS. Wait for Meta approval (24–48h).
   3. Business Settings → System users → Add → role Admin. Generate a
      **never-expires** token with permissions
      `whatsapp_business_messaging` and `whatsapp_business_management`.
      Paste into `META_WHATSAPP_ACCESS_TOKEN`.
   4. From the WhatsApp setup screen copy the **Phone Number ID** and
      **WABA ID** into `META_WHATSAPP_PHONE_NUMBER_ID` and
      `META_WHATSAPP_BUSINESS_ACCOUNT_ID`. App Settings → Basic → copy
      the **App secret** into `META_WHATSAPP_APP_SECRET`. Choose any
      random string for `META_WHATSAPP_VERIFY_TOKEN`.
   5. Webhook routing — once Make and ElevenLabs are set up:
      - Configure the Meta App → WhatsApp → Configuration webhook to
        forward inbound messages. The webhook URL will be the Make
        scenario 1 URL (text). Audio routing is handled by ElevenLabs's
        WhatsApp integration (configured separately in step 3 below).
      - Subscribe the webhook to the `messages` field.
   6. WhatsApp Manager → Message templates → Create a template named
      `chiachat_lesson_reminder` (body shown in
      [MAKE_SCENARIOS.md](./MAKE_SCENARIOS.md) § Scenario 7). Submit
      for approval (usually <1h).
3. **ElevenLabs**
   1. ElevenLabs dashboard → Voice Library → pick a warm Spanish
      female voice (search "spanish female warm"). Copy the voice
      ID into `ELEVENLABS_CHIA_VOICE_ID` and into Chia's row in
      the admin dashboard.
   2. Dashboard → Agents → create a Conversational Agent named
      "Chia (ChiaChat)". Use Chia's voice. Paste the agent prompt
      from `teachers.agent_voice_prompt` (visible after seed runs).
      Configure to respond to **audio with audio** and **text with
      text** — but for ChiaChat the agent should **only** receive audio
      (text is routed to Make).
   3. Dashboard → Agents → Chia → WhatsApp integration → connect to
      the same Meta WABA / WhatsApp Business number. ElevenLabs needs
      the same `META_WHATSAPP_ACCESS_TOKEN` and `PHONE_NUMBER_ID` to
      receive audio messages directly.
   4. Configure the agent's pre-response tool to read
      `pending_phrase` from `conversation_state` (see "Voice handoff
      protocol" in MAKE_SCENARIOS.md).
   5. Configure the agent's post-response webhook to POST to
      `https://YOUR-DEPLOYMENT/api/webhooks/elevenlabs` with header
      `Authorization: Bearer ${ELEVENLABS_WEBHOOK_SECRET}`. Payload:
      `{ whatsapp_number, transcription, agent_response, session_id, characters_used }`.
   6. Copy the agent ID into `ELEVENLABS_AGENT_ID` and into Chia's
      row in the admin dashboard.
4. **Stripe**
   1. Create a Product "ChiaChat Premium" with a monthly recurring
      price of €25.
   2. Create a Payment Link for that price. Enable
      "Collect customers' addresses → no", "Collect phone numbers →
      no". Copy the link into `STRIPE_PREMIUM_PAYMENT_LINK`. The
      Make scenario will append `?client_reference_id=<whatsapp>`
      so the webhook can identify the user.
   3. Webhooks → add endpoint
      `https://YOUR-DEPLOYMENT/api/webhooks/stripe`. Subscribe to:
      `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
      `invoice.paid`, `customer.subscription.deleted`. Copy the
      signing secret into `STRIPE_WEBHOOK_SECRET`.
5. **Make.com** — open [MAKE_SCENARIOS.md](./MAKE_SCENARIOS.md) and
   build the 8 scenarios in the order listed. Set
   `MAKE_STRIPE_REACTIVATION_WEBHOOK_URL` once Scenario 8's webhook
   exists.
6. **Local dev**
   ```bash
   npm install
   npm run dev
   ```
   Then visit `http://localhost:3000/admin/login`.
7. **Vercel deployment**
   1. Connect this repo to Vercel.
   2. Add every env var from the table above.
   3. Deploy. Update the Stripe and ElevenLabs webhook URLs to the
      Vercel domain.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` | Production build |
| `npm run start` | Run production build |
| `npm run lint` | Next.js ESLint |
| `npm run typecheck` | `tsc --noEmit` |

## Repo layout

```
app/                    Next.js 14 App Router
  admin/                Admin dashboard (Supabase Auth gated)
    (authed)/           Layout with sidebar — all pages except /admin/login
    login/              Public login page
  api/
    webhooks/
      stripe/           Stripe → us
      elevenlabs/       ElevenLabs Conv. Agent → us
    admin/              Internal CRUD endpoints used by the dashboard
components/
  ui/                   Buttons, inputs, badges, modals
  admin/                Sidebar, image grid, lesson editor, etc.
lib/
  supabase/             Client / server / admin clients
  stripe.ts             Lazy Stripe client
  utils.ts              cn(), formatters, masking, isAdminEmail()
  auth.ts               requireAdmin() helper for API routes
types/                  All shared types — DB rows, MemoryJson, LessonContent
supabase/
  schema.sql            Tables, indexes, RLS
  storage.sql           chiachat-media bucket
  seed.sql              Chia + 5 starter lessons
middleware.ts           /admin/* auth gate
MAKE_SCENARIOS.md       Make.com scenario specs (the actual product logic)
ROADMAP.md              Phase 2 — documented, not built
```

## Where the actual logic lives

The Next.js app in this repo is small on purpose. Every conversational
behaviour — Chia answering, lessons advancing, audio metering,
reminders, memory updates — happens in **Make.com scenarios** that
read/write the same Supabase tables. The voice-note correction loop
runs entirely inside the **ElevenLabs Conversational Agent**, with
`/api/webhooks/elevenlabs` as the bridge back to Supabase.

If something feels missing from this codebase, check
[MAKE_SCENARIOS.md](./MAKE_SCENARIOS.md) first — it's probably specified
there as a Make scenario.
