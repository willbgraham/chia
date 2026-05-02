# ChiaChat — Phase 2 roadmap

> Phase 1 (MVP) is what's currently built. Everything below is **not
> built** and is documented so the team can plan and prioritise.
> Do not start any of these without explicit approval.

## Additional languages and teachers

> Chia is ChiaChat's founding teacher and brand character —
> future teachers join her roster, but she remains the face of
> the product (think Duolingo's owl, but with personality).

Each new teacher needs:
- Row in `teachers` (system_prompt, agent_voice_prompt, voice ID, agent ID)
- Dedicated Meta Cloud API WhatsApp number (or a routing layer that maps
  inbound numbers → teacher_id)
- ElevenLabs Conversational Agent configured for that voice
- Curriculum entries in `lessons` for that language

Planned roster:
- **American English** — 3 female + 3 male
- **French** — 3 female + 3 male
- **Spanish** — 2 more female + 3 male alongside Chia
- **German** — 3 female + 3 male
- **Italian** — 3 female + 3 male

Required schema changes: none for this — `teachers.language` already
supports it. Add a teacher-picker step to onboarding.

## Teacher image delivery system

Chia (and others) sends images mid-conversation when contextually
appropriate — a photo of her in Valencia when talking about home,
a kitchen shot when talking about food, a celebratory selfie when
the student hits a milestone.

Mechanism:
- Make scenario watches for image-worthy moments via a GPT
  classifier on each turn.
- When triggered, queries `teacher_images` filtered by
  `context` and `tags`, picks one (round-robin / least-recently-sent).
- Sends via Meta Cloud API as image message.
- Records sent image in a new `teacher_image_sends` table to avoid
  repetition.

New schema: `teacher_image_sends(id, teacher_id, image_id, user_id,
sent_at)` plus an index on `(user_id, image_id)`.

## Video messages

Short personalised video clips for milestone moments and lesson
intros. Generation via HeyGen or Synthesia (lipsync to ElevenLabs
audio). Stored in Supabase Storage. Sent via Meta Cloud API as video
message.

New schema column: `teachers.heygen_avatar_id` or similar. New table
`teacher_video_clips` modelled on `teacher_images`.

## User-facing web app

Currently students live entirely in WhatsApp. Phase 2 adds an
optional web companion at `chiachat.app/student/...`:
- Magic-link login via WhatsApp number
- Progress dashboard — streak, lessons completed, audio minutes
- Memory snapshot ("what Chia knows about you")
- Upgrade flow (mirrors the in-WhatsApp Stripe link)
- Lesson history with full transcripts

Auth: Supabase Auth + WhatsApp OTP (custom function).

## Advanced memory (pgvector)

Replace the flat `memory_json` shape with a hybrid:
- Structured fields stay as JSONB (still authoritative for personal
  details, plan, level)
- Add `memory_chunks` table with `(id, user_id, content, embedding
  vector(1536), created_at)` and an HNSW index
- Chia's prompt construction does an embedding similarity search
  against the user's own chunks for "what's the relevant memory for
  this turn?"
- Long-term arc — Chia's relationship with the student evolves over
  months (anniversaries, recurring jokes, references to early
  conversations).

Requires `pgvector` extension and OpenAI embedding calls (cheap, but
adds latency to every turn — consider caching per-message).

## B2B tier

Corporate language training as a separate product surface:
- Team / org accounts with seat-based billing
- Admin dashboard for HR (different from internal ChiaChat admin):
  enrolment, progress reporting, invoice billing
- Branded teacher persona option (white-label)
- Stripe subscription with seat licenses

New tables: `organisations`, `org_memberships`,
`organisation_teachers` (custom branded teachers per org).

## Additional lesson content

- Full A1 → C2 curriculum for each language (~400 lessons each)
- Cultural lessons (food, music, travel, holidays — not just grammar)
- Idioms and slang (separate "topic" tags so structured mode can
  optionally pull them in)
- Business Spanish / French / German tracks
