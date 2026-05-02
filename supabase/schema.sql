-- ─────────────────────────────────────────────────────────────────────────────
-- ChiaChat — database schema
-- Run this once against a fresh Supabase project (SQL editor or psql).
-- All access is via service role; no RLS user policies are defined for MVP.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";

-- ── teachers ────────────────────────────────────────────────────────────────
create table if not exists teachers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  language text not null,
  gender text check (gender in ('female','male')),
  nationality text,
  age integer,
  whatsapp_number text,
  elevenlabs_voice_id text,
  elevenlabs_agent_id text,
  system_prompt text,
  agent_voice_prompt text,
  backstory text,
  profile_image_url text,
  is_active boolean default true,
  created_at timestamp with time zone default now()
);

create index if not exists idx_teachers_active
  on teachers (is_active)
  where is_active = true;

-- ── users ───────────────────────────────────────────────────────────────────
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  whatsapp_number text unique not null,
  teacher_id uuid references teachers(id),
  plan text default 'free' check (plan in ('free','premium')),
  memory_json jsonb default '{}'::jsonb,
  reminder_preference text default 'none'
    check (reminder_preference in ('daily','few_days','none')),
  reminder_time text,
  billing_period_start timestamp with time zone,
  stripe_customer_id text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create index if not exists idx_users_whatsapp on users (whatsapp_number);
create index if not exists idx_users_teacher on users (teacher_id);
create index if not exists idx_users_reminder
  on users (reminder_preference, reminder_time)
  where reminder_preference <> 'none';

-- ── conversation_state ──────────────────────────────────────────────────────
create table if not exists conversation_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references users(id) on delete cascade,
  state text not null default 'onboarding_step_1',
  pending_phrase text,
  pending_audio_url text,
  last_message_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create index if not exists idx_state_user on conversation_state (user_id);
create index if not exists idx_state_state on conversation_state (state);

-- ── audio_usage ─────────────────────────────────────────────────────────────
-- `source` distinguishes Make-driven outbound TTS from the
-- ElevenLabs Conversational Agent's STT+TTS bundle. We meter both
-- against the same monthly limit per user.
create table if not exists audio_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  characters_used integer not null,
  source text check (source in ('make_tts','elevenlabs_agent')),
  direction text check (direction in ('outbound','inbound')),
  created_at timestamp with time zone default now()
);

create index if not exists idx_audio_user on audio_usage (user_id);
create index if not exists idx_audio_user_created
  on audio_usage (user_id, created_at desc);

-- ── teacher_images ──────────────────────────────────────────────────────────
create table if not exists teacher_images (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid references teachers(id) on delete cascade,
  storage_url text not null,
  tags text[] default '{}',
  context text check (context in (
    'morning','evening','happy','thoughtful',
    'location','lesson','celebration',
    'correction','greeting','general'
  )),
  created_at timestamp with time zone default now()
);

create index if not exists idx_images_teacher on teacher_images (teacher_id);
create index if not exists idx_images_context on teacher_images (context);

-- ── lessons ─────────────────────────────────────────────────────────────────
create table if not exists lessons (
  id uuid primary key default gen_random_uuid(),
  language text not null,
  level text not null,
  topic text not null,
  lesson_number integer not null,
  title text not null,
  content jsonb not null,
  created_at timestamp with time zone default now()
);

create unique index if not exists uq_lessons_language_level_number
  on lessons (language, level, lesson_number);
create index if not exists idx_lessons_topic on lessons (topic);

-- ── user_lesson_progress ────────────────────────────────────────────────────
create table if not exists user_lesson_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  lesson_id uuid references lessons(id) on delete cascade,
  status text default 'not_started'
    check (status in ('not_started','in_progress','completed')),
  completed_at timestamp with time zone,
  notes text
);

create unique index if not exists uq_progress_user_lesson
  on user_lesson_progress (user_id, lesson_id);
create index if not exists idx_progress_user on user_lesson_progress (user_id);

-- ── updated_at triggers ─────────────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_users_updated on users;
create trigger trg_users_updated
  before update on users
  for each row execute function set_updated_at();

drop trigger if exists trg_state_updated on conversation_state;
create trigger trg_state_updated
  before update on conversation_state
  for each row execute function set_updated_at();

-- ── Row Level Security ──────────────────────────────────────────────────────
-- Enable RLS on every table. Service role bypasses RLS by default, so no
-- policies are defined for MVP; the admin Next.js app and Make.com both
-- use the service role key.
alter table teachers              enable row level security;
alter table users                 enable row level security;
alter table conversation_state    enable row level security;
alter table audio_usage           enable row level security;
alter table teacher_images        enable row level security;
alter table lessons               enable row level security;
alter table user_lesson_progress  enable row level security;
