-- ─────────────────────────────────────────────────────────────────────────────
-- ChiaChat — Supabase Storage setup
-- Run after schema.sql, once per project.
-- Creates the chiachat-media bucket used for:
--   - teachers/{teacher_id}/...           (admin-uploaded teacher images)
--   - audio/outbound/{user_id}/...        (Chia's TTS messages from Make)
--   - audio/inbound/{user_id}/...         (raw user voice notes — only if Make
--                                          ever needs to mirror; ElevenLabs
--                                          agent doesn't write here)
-- All access via service role; no public read.
-- ─────────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public)
values ('chiachat-media', 'chiachat-media', false)
on conflict (id) do nothing;

-- No bucket-level RLS policies are defined — the service role key used by
-- the Next.js admin app and Make.com bypasses RLS. If you later expose the
-- bucket to anon users, add policies here.
