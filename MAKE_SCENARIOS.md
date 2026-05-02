# Make.com scenarios — ChiaChat MVP

This document specifies every Make.com scenario ChiaChat needs.
Build each in [Make.com](https://make.com) using the modules and logic described.
None of these scenarios are written in code — Make is the runtime
for all conversational logic.

> Architecture recap. ChiaChat is a hybrid system:
>
> - **Make.com** owns text messages (onboarding, lessons, free chat,
>   memory, metering, reminders, Stripe upgrade flow).
> - **ElevenLabs Conversational Agent** owns audio messages (voice notes
>   from the student → STT → pronunciation analysis → Chia's voice
>   reply → back via WhatsApp). The agent is connected to the same
>   WhatsApp Business number as Make.
> - **Meta WhatsApp Cloud API** is the WhatsApp Business gateway —
>   it sends every inbound message to one webhook URL we configure
>   in the Meta App. Make.com owns that webhook and acts as the
>   router: text messages stay in Make, audio messages are handed
>   off to the ElevenLabs Conversational Agent via API call. (See
>   "Voice handoff protocol" below for details.)
> - **Next.js** (this codebase) handles two webhooks: `/api/webhooks/stripe`
>   (Stripe events) and `/api/webhooks/elevenlabs` (post-voice-exchange
>   bridge from the agent back to Supabase + Make).
>
> Make never handles raw audio. It only initiates outbound TTS for
> Chia speaking a target phrase unprompted (Scenario 5).

---

## Conventions

- **DB:** all Supabase reads/writes use the **service role key**.
- **Errors:** wrap each scenario's GPT/HTTP call in an error handler
  that logs `console.log`-style to a Make notification channel (or
  Slack) — do not surface raw errors to the user.
- **Auth:** the Stripe and ElevenLabs webhooks are HTTP endpoints in
  the Next.js app; they are not Make scenarios.
- **Idempotency:** scenarios that update `conversation_state` should
  always set `last_message_at = now()` so reminders behave correctly.

---

## Voice handoff protocol (read this first)

The single most important integration point. Two questions:

### Q1. How does Make signal to the ElevenLabs agent that voice practice is starting?

The handoff is **active**, because Meta only delivers inbound
messages to one webhook URL. Make's webhook is that URL.

1. Scenario 5 (Audio confirm handler) writes `pending_phrase` to
   `conversation_state`, sends Chia's "now try saying it back to me"
   text via Meta WhatsApp Cloud API, and updates `state` to `awaiting_voice_note`.
2. The student replies with a voice note. Meta delivers it to
   Make's webhook (Scenario 1). Scenario 1 detects
   `messages[0].type === 'audio'`.
3. Scenario 1 forwards the audio to the ElevenLabs Conversational
   Agent via the agent's HTTP API:
   ```
   POST https://api.elevenlabs.io/v1/convai/agents/{AGENT_ID}/messages
   Authorization: Bearer {ELEVENLABS_API_KEY}
   Body: { whatsapp_number, audio_media_id, pending_phrase, student_name }
   ```
   The agent does STT, generates Chia's audio reply, and sends it
   back to the student via Meta Cloud API (using the credentials
   ElevenLabs has stored in its WhatsApp integration config).
4. After the exchange, the agent posts to
   `/api/webhooks/elevenlabs` (this codebase) — see Q2.

Configure the ElevenLabs agent with a Supabase function/tool that
performs:

```sql
select pending_phrase, c.user_id, u.memory_json -> 'name' as name
from conversation_state c
join users u on u.id = c.user_id
where u.whatsapp_number = $1
limit 1;
```

This gives the agent everything it needs (target phrase + student name)
to produce a warm specific correction.

### Q2. How does Make detect when the voice exchange is complete?

The agent fires a webhook to **`POST /api/webhooks/elevenlabs`** after
each exchange. That route (in this codebase) does three things:

1. Inserts `audio_usage` rows with `source='elevenlabs_agent'` for
   STT and TTS character counts.
2. Appends a pronunciation note to `memory_json.language_progress.pronunciation_notes`.
3. Sets `conversation_state.state` back to `active_free_chat` or
   `active_structured_lesson` (based on `memory_json.lesson_mode` and
   `curriculum_position`), and clears `pending_phrase`.

After the state flip, the student's **next text message** lands in
the Make text-message router (Scenario 1) and the conversation
continues normally. No Make scenario needs to actively detect the
end of a voice exchange — the state machine handles it.

---

## Scenario 1 — Inbound text message router

**Trigger:** Meta WhatsApp Cloud API inbound webhook (`POST` from
Meta to a Make custom webhook URL — you set this URL in
**developers.facebook.com → your app → WhatsApp → Configuration**,
subscribed to the `messages` field). Configured for **text messages
only**. Audio messages bypass this and go to the ElevenLabs agent.

**Modules in order:**

1. **Custom webhook trigger.** Meta's payload is nested — Make
   exposes the inner message after you build the path:
   ```json
   {
     "object": "whatsapp_business_account",
     "entry": [{
       "changes": [{
         "value": {
           "messages": [{
             "from": "447400123456",
             "type": "text",
             "text": { "body": "How do I say hello?" },
             "timestamp": "1729..."
           }],
           "contacts": [{ "profile": { "name": "Will" }, "wa_id": "447400123456" }]
         }
       }]
     }]
   }
   ```
   Make sure your webhook responds to Meta's GET verification handshake
   (`?hub.verify_token=...&hub.challenge=...`) by echoing the challenge.
   Reference the inbound message via
   `{{1.entry[0].changes[0].value.messages[0]}}` in subsequent modules.
   The sender number is `messages[0].from` — note Meta sends it WITHOUT
   the leading `+`, so prepend it before Supabase lookup.
2. **Supabase: search users** — `whatsapp_number = '+' + {{messages[0].from}}`. Returns 0 or 1 row.
3. **Router:**
   - **Path A — new user (0 rows):** create user row with
     `whatsapp_number = {{1.from}}`, `teacher_id` = Chia's UUID
     (cache as a Make data store), `memory_json = {}`. Create
     `conversation_state` row with `state = 'onboarding_step_1'`.
     Then trigger Scenario 2 with `whatsapp_number` and the inbound
     message body.
   - **Path B — existing user:** Supabase get `conversation_state`
     by `user_id`. Branch on `state`:
     - `onboarding_step_1..7` → Scenario 2 (onboarding)
     - `active_free_chat` → Scenario 3 (free chat)
     - `active_structured_lesson` → Scenario 4 (lesson)
     - `awaiting_audio_confirm` → Scenario 5 (audio confirm)
     - `awaiting_voice_note` → fallback handler: gentle text reply
       ("I was waiting for a voice note 🎵 but text is fine — let me
       check what you said") then proceed as Scenario 3
     - `idle` → Scenario 3
4. **Update** `conversation_state.last_message_at = now()`.

**Reads:** `users`, `conversation_state`. **Writes:** `users` (on
new user only), `conversation_state.last_message_at`.

**Error handling:** if Supabase lookup fails, return 200 to Meta WhatsApp Cloud API
(don't make WhatsApp retry) and log to Slack.

---

## Scenario 2 — Onboarding handler (steps 1–7)

**Trigger:** Sub-scenario called from Scenario 1.

Make a 7-branch router on the user's current `conversation_state.state`:

### Step 1 → Step 2

- Send Chia's onboarding opener via Meta WhatsApp Cloud API:
  ```
  ¡Hola! Soy Chia 🌿
  I'm going to teach you Spanish — and I promise it's
  going to feel nothing like school.
  What's your name?
  ```
- Update state to `onboarding_step_2`. (Scenario 1 will re-enter when
  the user replies.)

When the user replies in `onboarding_step_2`:
- Set `memory_json.name = {{user_text}}`.
- Send the language question with numbered options.
- Update state to `onboarding_step_3`.

### Step 3 → Step 4

When in `onboarding_step_3` and user replies:
- Parse `1/2/3/4` (or "english", "french" etc.) → set
  `memory_json.native_language`.
- For MVP only `1` (English) is fully supported — if anything else,
  reply: "I'll be honest — for now I'm best at teaching in English.
  Want to continue in English?" and stay in step 3.
- Send the level question.
- Update state to `onboarding_step_4`.

### Step 4 → Step 5

When in `onboarding_step_4`:
- Parse `1/2/3/4` → set `memory_json.level` to
  `beginner/intermediate/advanced` (group 1+2 as beginner).
- If structured/both: also set
  `memory_json.curriculum_position.current_topic = 'greetings'` and
  `current_lesson = 1`.
- Send the learning style question.
- Update state to `onboarding_step_5`.

### Step 5 → Step 6

When in `onboarding_step_5`:
- Parse → set `memory_json.lesson_mode` to `structured/free/both`.
- Send the reminder question.
- Update state to `onboarding_step_6`.

### Step 6 reminders sub-flow → Step 7

When in `onboarding_step_6`:
- Parse `1/2/3` → set `reminder_preference`.
- If `daily` or `few_days`: ask "What time works best?". When the
  user replies, parse a time string ("9am", "20:00") into 24h `HH:mm`,
  set `users.reminder_time`. Update state to `onboarding_step_7`.
- If `none`: skip directly to `onboarding_step_7` and send the plan
  question.

### Step 7 → first interaction

When in `onboarding_step_7`:
- Parse `1/2` → set `memory_json.plan = 'free'` or `'premium'`.
- If premium: append `?client_reference_id={{whatsapp_number}}` to the
  Stripe payment link from env, send via Meta WhatsApp Cloud API as a clickable
  link. Stay in step 7 until Stripe webhook fires.
- If free: send the welcome-to-first-interaction message:
  - If lesson_mode in `structured/both`: "Your first lesson is greetings
    — ready? 🇪🇸" and update state to `active_structured_lesson`.
  - Else: "Ask me anything, I'm here 😊" and update state to `active_free_chat`.

**Writes:** `users.memory_json`, `users.reminder_preference`,
`users.reminder_time`, `conversation_state.state`.

---

## Scenario 3 — Free chat handler

**Trigger:** sub-scenario from Scenario 1 when `state = active_free_chat`
(or fallback from `awaiting_voice_note`).

**Modules:**

1. **Supabase get user** — fetch `memory_json`, `plan`,
   `billing_period_start`.
2. **Supabase get teacher** — `teacher_id` from user → `system_prompt`,
   `name`.
3. **Supabase get last 20 messages** — Make does NOT have a messages
   table in MVP. Build the last-N-messages array by buffering them
   in a Make data store keyed by `user_id`. Cap at 20, drop oldest.
4. **OpenAI ChatCompletion (GPT-4o-mini):**
   - System: `teachers.system_prompt` with placeholders substituted:
     - `[MEMORY_JSON]` → JSON.stringify(memory_json)
     - `[STATE]` → `active_free_chat`
     - `[LAST_20_MESSAGES]` → conversation buffer
   - User: current message text.
5. **Parse response for audio cue.** If response contains
   "Want to hear me say it" or any phrase ending with `🎵`, extract
   the target phrase via a small follow-up GPT call:
   "Extract the Spanish phrase the teacher just offered to read aloud.
   Return only the phrase, nothing else." → store in
   `conversation_state.pending_phrase`, set `state = awaiting_audio_confirm`.
6. **Send response** via Meta WhatsApp Cloud API text message.
7. **Append to message buffer** in Make data store.

**Reads:** `users`, `teachers`, message buffer.
**Writes:** `conversation_state` (state, pending_phrase),
message buffer.

**Free-tier guard:** if `plan = 'free'` and the response would offer
audio, don't extract a phrase — Chia's text response is sent as-is
and the audio offer is decorative.

---

## Scenario 4 — Structured lesson handler

**Trigger:** sub-scenario from Scenario 1 when `state = active_structured_lesson`.

**Modules:**

1. **Supabase get user** — read `memory_json.curriculum_position`.
2. **Supabase get current lesson:**
   ```
   from lessons
   where language = 'Spanish'
     and level = memory.level
     and topic = memory.curriculum_position.current_topic
     and lesson_number = memory.curriculum_position.current_lesson
   ```
3. **GPT-4o-mini formatter:**
   - System: same Chia system_prompt.
   - User: "Format this lesson content for WhatsApp. Use short
     paragraphs, emojis. End with offering audio for the first
     audio_worthy item. Lesson:" + JSON of `lesson.content`.
4. **Send formatted message** via Meta WhatsApp Cloud API.
5. **Set pending_phrase** to the first `audio_worthy` item's
   `target_language`. Update state to `awaiting_audio_confirm`.

**On lesson completion** (when the student has worked through every
audio_worthy item via the voice loop, OR the GPT formatter signals
completion):

- Insert `user_lesson_progress` row with `status='completed'`,
  `completed_at = now()`.
- Increment `memory_json.curriculum_position.current_lesson` (or
  advance to the next topic if last lesson).
- Append topic to `memory_json.curriculum_position.completed_topics`.
- Update state to `active_free_chat` and send a celebratory message.

**Reads:** `users`, `lessons`. **Writes:** `users.memory_json`,
`user_lesson_progress`, `conversation_state`.

---

## Scenario 5 — Audio confirm handler (outbound TTS)

**Trigger:** sub-scenario from Scenario 1 when `state = awaiting_audio_confirm`.

**Modules:**

1. **Yes/no parser** — GPT-4o-mini classifier on user's reply.
   "yes/sí/yeah/okay/please/🎵" → yes. Otherwise → no.
   - If no: text reply ("No worries 😊 we'll keep texting") and
     set state back to `active_free_chat`.
2. **Quota check** — sum
   `audio_usage.characters_used` for `user_id` since
   `users.billing_period_start` (or current month start if null).
3. **Branch:**
   - **Within limit:** continue.
   - **At limit (>= 50,000):** send "We've hit your voice limit for
     this month — text continues, and you can upgrade here:
     {{stripe_payment_link}}?client_reference_id={{whatsapp_number}}".
     Set state to `active_free_chat`. Stop.
4. **Get pending_phrase** from `conversation_state`.
5. **ElevenLabs TTS API call** — `POST /v1/text-to-speech/{voice_id}`
   with `text = pending_phrase`. Use `teachers.elevenlabs_voice_id`.
   Receive MP3 binary.
6. **Supabase Storage upload** — bucket `chiachat-media`, path
   `audio/outbound/{user_id}/{epoch}.mp3`.
7. **WhatsApp Cloud API → send audio** — POST the MP3 as an audio
   message to `https://graph.facebook.com/v21.0/{PHONE_NUMBER_ID}/messages`
   (Make's "WhatsApp Cloud API → Send a message" module handles this).
8. **Insert audio_usage** — `characters_used = pending_phrase.length`,
   `source = 'make_tts'`, `direction = 'outbound'`.
9. **Send follow-up text** — "Now want to try saying it back to me?
   🎵 Just send a voice note."
10. **Update state** to `awaiting_voice_note` and clear
    `pending_audio_url` (the next inbound audio is handled by
    ElevenLabs agent, not Make).

**80% / 95% warnings:** before step 8, if the new total puts the
user past those thresholds (and they weren't past before), append
the appropriate warning text to step 9. (See PRODUCT brief for
exact wording.)

**Reads:** `audio_usage`, `users`, `conversation_state`, `teachers`.
**Writes:** `audio_usage`, `conversation_state`, Supabase Storage.

---

## Scenario 6 — Memory updater

**Trigger:** two paths.

A. **Scheduled (every 5 min):** find users where
   `now() - last_message_at > 20 minutes` AND `last_message_at >
   last_memory_update_at` (track the latter in Make data store).

B. **Webhook from `/api/webhooks/elevenlabs`:** triggered after
   every voice exchange. Make exposes a webhook URL; configure
   the Next.js webhook (or a small Edge Function) to forward the
   `whatsapp_number` to this Make webhook after persisting.

**Modules:**

1. Get user + recent message buffer + most recent pronunciation
   notes from `memory_json.language_progress.pronunciation_notes`.
2. **GPT-4o-mini extraction prompt:**
   "Read this conversation excerpt. Update the memory JSON.
   Add new personal details, language progress, milestones, inside
   references. Don't invent. Don't remove existing data unless
   contradicted. Return only valid JSON.
   Existing memory: {{memory_json}}.
   Recent conversation: {{buffer}}.
   Recent pronunciation notes: {{notes}}."
3. **Validate JSON** — if invalid, log and skip update.
4. **Supabase update users** — set `memory_json = {{merged}}`,
   `updated_at = now()`.

**Reads:** `users`, message buffer. **Writes:** `users.memory_json`.

---

## Scenario 7 — Reminder scheduler

**Trigger:** scheduled — runs **every hour on the hour**.

**Modules:**

1. **Supabase query users:**
   ```
   from users
   where reminder_preference != 'none'
     and reminder_time = current_hour_HH:mm   -- in UTC, normalised
   ```
2. **For each:** check `conversation_state.last_message_at`:
   - `daily` → fire if last_message_at < `now() - 23h`.
   - `few_days` → fire if last_message_at < `now() - 3 days`.
3. **Send via Meta WhatsApp Cloud API template message** (NOT a free-text message
   — outside the 24h service window WhatsApp requires templates):
   - Template name: `chiachat_lesson_reminder` (must be approved in
     Meta Business Manager before scenario will deliver)
   - Variables: `{{1}} = student name from memory_json.name`,
     `{{2}} = teacher name = "Chia"`.
   - Body (submit to Meta for approval):
     `"Hola {{1}}! It's {{2}} 🌿 I haven't heard from you in a while — ready to practise your Spanish today?"`

**Reads:** `users`, `conversation_state`. **Writes:** none directly
(Meta WhatsApp Cloud API handles delivery).

---

## Scenario 8 — Stripe reactivation relay

**Trigger:** Make webhook called from `/api/webhooks/stripe` after
the Next.js handler updates the user to premium.

**Modules:**

1. Webhook receives `{ whatsapp_number, event }`.
2. Send via Meta WhatsApp Cloud API text message:
   `"¡Estás de vuelta! 🎉 Now we can talk as much as we want — including voice practice 🎵 Where were we...? 😊"`
3. Optionally update `conversation_state.state` to `active_free_chat`
   if currently `idle`.

The webhook URL is stored in `MAKE_STRIPE_REACTIVATION_WEBHOOK_URL`
in the Next.js app's env vars.

**Reads:** none. **Writes:** none required (state update optional).

---

## Build order suggestion

1. **Scenario 1** (router) — without it, no other scenario fires.
2. **Scenario 2** (onboarding) — needed for any new user to exist.
3. **Scenario 3** (free chat) — minimum viable conversation.
4. **Scenario 5** (audio TTS) — first paid feature; ties into the
   ElevenLabs agent handoff.
5. **Scenario 4** (structured lessons) — once seed lessons exist.
6. **Scenario 6** (memory updater) — once conversations are flowing.
7. **Scenario 7** (reminders) — after Meta template approval.
8. **Scenario 8** (Stripe reactivation) — after first Stripe upgrade
   completes end to end.
