-- supabase/migrations/20260622000000_trigger_migration.sql
--
-- Schema additions for the Trigger.dev migration. This migration does NOT
-- create any new tables — it only:
--   1. Adds a `storage_path` column to the existing `download_history`
--      table (so the polling endpoint can mint signed URLs for the
--      whole-manga CBZ file).
--   2. Adds a unique constraint on `manga (source, source_manga_id)` so
--      the task can idempotently upsert manga rows.
--   3. Creates the `cbz` private storage bucket + RLS policies scoped to
--      per-user prefixes (cbz/<user_id>/<run_id>.cbz).
--
-- The Trigger task writes to: manga, chapters, pages, download_history.
-- No `downloads` table — Trigger.dev itself is the source of truth for
-- run status, progress, and the final storagePath (returned in run.output).

-- ── 1. download_history.storage_path ──────────────────────────────────
-- Nullable. Set when a download completes — points at the cbz bucket path
-- (e.g. "<user_id>/<run_id>.cbz"). All chapter rows from the same manga-
-- level CBZ share this value.
alter table public.download_history
  add column if not exists storage_path text;

-- Index for "find all downloads for this storage_path" (used by the
-- polling endpoint's auth check and any future "download history" UI).
create index if not exists download_history_storage_path_idx
  on public.download_history (storage_path);

-- ── 2. manga unique constraint ────────────────────────────────────────
-- Lets the task upsert idempotently when the same manga is downloaded
-- twice (re-download, different user, etc.).
create unique index if not exists manga_source_source_manga_id_uniq
  on public.manga (source, source_manga_id);

-- ── 3. Storage bucket ─────────────────────────────────────────────────
-- Private bucket — download URLs are minted server-side as signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'cbz',
  'cbz',
  false,
  1073741824, -- 1 GB limit per file
  array['application/vnd.comicbook+zip', 'application/zip']
)
on conflict (id) do nothing;

-- Storage RLS: users can only read/write objects under their own prefix
-- (cbz/<user_id>/<run_id>.cbz). The Trigger task uploads via the service
-- role key so it's unaffected by these policies.
--
-- NOTE: storage.foldername(name) returns text[] — the first element is
-- the top-level folder, which we conventionally set to the user's id.
drop policy if exists "users read own cbz" on storage.objects;
create policy "users read own cbz"
  on storage.objects for select
  using (
    bucket_id = 'cbz'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users write own cbz" on storage.objects;
create policy "users write own cbz"
  on storage.objects for insert
  with check (
    bucket_id = 'cbz'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users update own cbz" on storage.objects;
create policy "users update own cbz"
  on storage.objects for update
  using (
    bucket_id = 'cbz'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users delete own cbz" on storage.objects;
create policy "users delete own cbz"
  on storage.objects for delete
  using (
    bucket_id = 'cbz'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
