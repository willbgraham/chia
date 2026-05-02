# ChiaChat — Architecture

ChiaChat is a Next.js app deployed on Vercel. **All conversation logic lives
inside this codebase** — there is no separate orchestration layer (no
Make.com, Zapier, n8n, etc.). The app handles inbound WhatsApp messages
end-to-end via API routes and helper libs.

## High-level flow

```
                     ┌──────────────────┐
   Student 📱 ─────► │  WhatsApp        │
                     └────────┬─────────┘
                              │ Meta Cloud API webhook
                              ▼
              ┌─────────────────────────────────┐
              │  /api/webhooks/whatsapp         │
              │  - HMAC verifies signature      │
              │  - parses Meta payload          │
              │  - calls handleInbound()        │
              └────────────┬────────────────────┘
                           │
                           ▼
              ┌─────────────────────────────────┐
              │  lib/handlers/route-message.ts  │
              │  - finds/creates user           │
              │  - reads conversation_state     │
              │  - dispatches by state          │
              └────┬────────────────────────────┘
                   │
        ┌──────────┼──────────┬─────────┬─────────────┬──────────────┐
        ▼          ▼          ▼         ▼             ▼              ▼
  onboarding  free-chat  lesson    audio-confirm  voice-note   (other)
   (steps 1-7) (GPT)    (curric.)   (TTS + meter)  (ElevenLabs)
        │          │          │         │             │
        └──────────┴──────────┴─────────┴─────────────┘
                   │
                   ▼
        ┌─────────────────────────────────┐
        │   lib/messaging/whatsapp.ts     │
        │   sendText / sendAudio /        │
        │   sendTemplate                  │
        └────────────┬────────────────────┘
                     │ Meta Graph API
                     ▼
                Student receives reply
```

## Module map

```
app/api/
  webhooks/
    whatsapp/route.ts        ← Meta inbound (text + audio); HMAC verify
    stripe/route.ts          ← Stripe events; signature verify; flips plan
    elevenlabs/route.ts      ← Post-call webhook from voice agent
  cron/
    reminders/route.ts       ← Hourly: send chiachat_lesson_reminder template
    memory-updater/route.ts  ← Every 10 min: GPT extracts memory updates
  admin/
    *                        ← Internal CRUD for admin dashboard

lib/
  messaging/
    whatsapp.ts              ← Meta Graph API client
    openai.ts                ← Chat completion, memory extraction
    elevenlabs.ts            ← TTS + Conversational Agent invocation
    audio-cache.ts           ← Cached MP3 lookup in Supabase Storage
  handlers/
    route-message.ts         ← Top-level dispatcher
    state.ts                 ← conversation_state read/write
    memory.ts                ← memory_json read/merge/write
    usage.ts                 ← audio character metering
    onboarding.ts            ← 7-step signup flow
    free-chat.ts             ← GPT-driven free conversation
    lesson.ts                ← Structured curriculum delivery
    audio-confirm.ts         ← TTS for "want to hear me say it?"
    voice-note.ts            ← Voice-note → ElevenLabs agent handoff
  supabase/
    client.ts / server.ts / admin.ts
  stripe.ts
  utils.ts
  auth.ts                    ← /admin/* gate

vercel.json                  ← Cron schedules
```

## State machine

`conversation_state.state` drives routing for every text message. States:

| State | Set by | Cleared by |
|---|---|---|
| `onboarding_step_1..7` | New user creation, step transitions | Plan choice (step 7) |
| `active_free_chat` | Onboarding completion, voice-note end | — |
| `active_structured_lesson` | Onboarding (if lesson_mode=structured/both), lesson advance | After audio offer |
| `awaiting_audio_confirm` | Free chat / lesson when audio is offered | User reply (yes→TTS, no→free chat) |
| `awaiting_voice_note` | After Chia speaks a phrase | ElevenLabs agent post-call webhook |
| `idle` | Long inactivity (set by reminder cron, optional) | Next user message |

## External services

| Service | Used for | Auth |
|---|---|---|
| Meta WhatsApp Cloud API | Send/receive messages | `META_WHATSAPP_ACCESS_TOKEN` (system user, never-expires) |
| OpenAI GPT-4o-mini | Chat replies, memory extraction | `OPENAI_API_KEY` |
| ElevenLabs TTS | Outbound audio for target phrases | `ELEVENLABS_API_KEY` |
| ElevenLabs Conversational Agent | Voice-note correction loop | `ELEVENLABS_AGENT_ID` |
| Supabase | DB + Storage + Auth | `SUPABASE_SERVICE_ROLE_KEY` (server) |
| Stripe | Payments | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| Vercel Cron | Scheduled jobs (reminders, memory) | `CRON_SECRET` |

## Cron jobs

Defined in [`vercel.json`](./vercel.json):

| Path | Schedule | Purpose |
|---|---|---|
| `/api/cron/reminders` | `0 * * * *` (hourly) | Send template reminders to users whose `reminder_time` matches the current UTC hour and who've been idle longer than their preference |
| `/api/cron/memory-updater` | `*/10 * * * *` (every 10 min) | Extract personal/language facts from idle users' recent transcripts via GPT |

Both routes verify `Bearer $CRON_SECRET` (Vercel auto-attaches this header to cron invocations).

## Deferred-to-Phase-2 architectural changes

See [ROADMAP.md](./ROADMAP.md) for product-level Phase 2 plans. Architectural changes that aren't built yet:

- **Messages table.** Recent message history is currently buffered inside `memory_json._recent` (capped at 20). Once we add a dedicated `messages` table we can support longer context windows and per-message metadata.
- **Vector memory.** `memory_json` is flat JSONB today. Phase 2 plan: pgvector embeddings for semantic memory recall.
- **Multi-teacher routing.** Right now the inbound webhook always assigns Chia (the only active teacher). Phase 2 routes by `whatsapp_number` to teacher-specific WABAs.

## Why no Make.com

ChiaChat originally sketched a hybrid Make + Next.js architecture. We dropped Make because:

1. Make has **no native WhatsApp Cloud connector** — you end up using HTTP modules anyway, so Make's value-add is just the visual flow editor.
2. **Cost scales poorly**: at 500 users, Make's per-operation pricing exceeds $300/mo. Replacing it with code costs $0 marginal (Vercel functions are free at our scale).
3. **Single codebase wins**: type safety end-to-end, one log stream, easier debugging, version-controlled changes.

If you ever need a no-code branch (e.g. business team adding a marketing flow), Make can be added back at the edges without touching the core conversation logic.
