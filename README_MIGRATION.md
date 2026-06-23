# MDL → Trigger.dev Migration (v2 — uses your existing Supabase schema)

This bundle moves the manga download pipeline off Vercel's serverless
timeout and onto Trigger.dev v3, **writing into your existing normalized
schema** (`manga`, `chapters`, `pages`, `download_history`) instead of
adding a new `downloads` table.

## What changed

**Before:** `/api/v1/download` did all the scraping, downloading, and
zipping synchronously inside the request. Anything bigger than a tiny
manga blew past Vercel's 10s (Hobby) / 60s (Pro) / 300s (max) ceiling.

**After:** `/api/v1/download` just enqueues a Trigger.dev task and
returns the run id immediately. The task does the slow work in Trigger's
runtime (no timeout ceiling), writes metadata into your existing schema,
uploads the `.cbz` to Supabase Storage, and writes one `download_history`
row per chapter included. The dashboard polls `/api/v1/jobs/:runId`,
which reads live status from Trigger via `runs.retrieve()`.

WeebCentral scraping was rewritten to `axios` + `cheerio` in the original
migration, on the assumption that WeebCentral served page images in the
initial HTML. **That assumption was wrong** — WeebCentral's chapter pages
inject page images via client-side JS after load, so the cheerio version
returned zero images for every WeebCentral URL. This has been reverted:
the scraper now uses Playwright again (`chromium.launch()`, navigate,
scroll to trigger lazy-load, then read `img.src` after hydration — the
same approach the pre-Trigger version used). The difference from before
is _where_ it runs: Playwright now executes inside the Trigger.dev task,
not a Vercel function, via the `playwright` build extension added to
`trigger.config.ts`. Trigger's runtime has no 300 MB function-size
ceiling and can spawn the browser child process, so the constraint that
originally forced the move away from Playwright doesn't apply there.

## Where data lands

```
User pastes URL → /api/v1/download
                    │
                    └─→ downloadMangaTask.trigger({ userId, url, source })
                                │
                                ↓  (in Trigger runtime)
                    ┌──────────────────────────────────┐
                    │ 1. Scrape → { mangaName, chapters[] }
                    │ 2. UPSERT manga                  │  ← idempotent on (source, source_manga_id)
                    │ 3. DELETE + INSERT chapters      │  ← one row per chapter, FK → manga.id
                    │ 4. INSERT pages                  │  ← one row per page, FK → chapters.id
                    │ 5. buildMangaCbzBuffer()         │  ← progress → io.updateMetadata
                    │ 6. Storage.upload(cbz/<uid>/<runId>.cbz)
                    │ 7. INSERT download_history       │  ← one row per chapter, all share storage_path
                    └──────────────────────────────────┘
                                │
                                ↓
                    run.output = { storagePath, mangaId, mangaName, ... }
                                │
Dashboard polls /api/v1/jobs/:runId every 2.5s
  → runs.retrieve(runId) → { status, metadata.progress, output.storagePath }
  → when COMPLETED, mint signed Storage URL → trigger <a download>
```

## Files in this bundle

| File                                                           | Status    | What it does                                                                                                                                             |
| -------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trigger/download-manga.ts`                                    | NEW       | The Trigger.dev task. Resolve → upsert manga → write chapters/pages → build CBZ → upload → write download_history.                                       |
| `app/api/v1/download/route.ts`                                 | REWRITTEN | Just auths + enqueues the task + returns `{ runId }`.                                                                                                    |
| `app/api/v1/jobs/[id]/route.ts`                                | NEW       | Polling endpoint. Calls `runs.retrieve(runId)`, mints signed Storage URL when COMPLETED.                                                                 |
| `app/backend/downloadLogicForManualAndWeebcentral/download.ts` | UPDATED   | Added `buildMangaCbzBuffer` (Buffer sink + progress callback). Original `buildMangaCbzStream` unchanged.                                                 |
| `app/backend/weebcentral/scrapping/getImageURLFromInputURL.ts` | REVERTED  | Back to Playwright (cheerio version returned zero images — see "What changed" above). Runs inside the Trigger task via the `playwright` build extension. |
| `app/dashboard/page.tsx`                                       | UPDATED   | `handleAddDownload` enqueues + polls by runId. Pollers cleaned up on unmount.                                                                            |
| `supabase/migrations/20260622000000_trigger_migration.sql`     | NEW       | Adds `storage_path` to `download_history`, unique constraint on `manga(source, source_manga_id)`, `cbz` storage bucket + RLS. **No new tables.**         |
| `.env.example`                                                 | NEW       | All env vars you need.                                                                                                                                   |

## Install

```bash
# 1. New dependencies
pnpm add @trigger.dev/sdk cheerio
pnpm add -D @types/cheerio

# 2. Drop the files into your project, preserving the directory structure.
#    The files overwrite their existing counterparts.

# 3. Copy env vars from .env.example into your .env.local (and Vercel,
#    and the Trigger.dev dashboard).
cp .env.example .env.local
# fill in the real values

# 4. Run the Supabase migration
supabase db push
# or: paste the SQL into the Supabase SQL editor

# 5. Log in to Trigger.dev + link the project
npx trigger.dev@latest login
npx trigger.dev@latest init    # if not already linked

# 6. Deploy the task to Trigger's runtime
npx trigger.dev@latest deploy
```

## Running locally

You need **two** terminals:

```bash
# Terminal 1 — Next.js
pnpm dev

# Terminal 2 — Trigger.dev dev server (connects local task code to
# Trigger's runtime so you can test without deploying)
npx trigger.dev@latest dev
```

## Env vars — where they need to live

| Var                                    | Vercel | Trigger.dev dashboard | `.env.local` |
| -------------------------------------- | :----: | :-------------------: | :----------: |
| `NEXT_PUBLIC_SUPABASE_URL`             |   ✓    |           ✓           |      ✓       |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |   ✓    |           —           |      ✓       |
| `SUPABASE_SERVICE_ROLE_KEY`            |   ✓    |           ✓           |      ✓       |
| `TRIGGER_SECRET_KEY`                   |   ✓    |       ✓ (auto)        |      ✓       |
| `TRIGGER_API_URL`                      |   ✓    |       ✓ (auto)        |      ✓       |
| `NEXT_PUBLIC_TRIGGER_PUBLIC_KEY`       |   ✓    |           —           |      ✓       |

**Critical:** `SUPABASE_SERVICE_ROLE_KEY` must be set on the Trigger.dev
dashboard (Environment Variables), not just Vercel — the task runs in
Trigger's runtime, not Vercel's.

## Migration SQL — what it does

The migration is intentionally minimal. It does NOT create any new tables.

1. **`download_history.storage_path`** (nullable `text`) — set when a
   download completes; points at the cbz bucket path
   (`<user_id>/<run_id>.cbz`). All chapter rows from the same manga-level
   CBZ share this value.
2. **`manga(source, source_manga_id)` unique index** — lets the task
   upsert idempotently when the same manga is downloaded twice.
3. **`cbz` storage bucket** — private, 1 GB file limit, RLS scoped to
   per-user prefixes (`storage.foldername(name)[1] = auth.uid()`).

The existing RLS policies on `manga`, `chapters`, `pages`,
`download_history` from your schema screenshot are unchanged. The
Trigger task uses the service role key, which bypasses RLS — that's
intentional, since the task needs to write metadata for any user.

## Gotchas

1. **`SUPABASE_SERVICE_ROLE_KEY` on Trigger** — if you forget this, the
   task fails to write metadata or upload the CBZ. Jobs will appear
   stuck in `running`. Check the Trigger.dev dashboard logs.

2. **Polling auth** — `/api/v1/jobs/:runId` checks that the run's
   `storagePath` starts with `<user_id>/` before minting a signed URL.
   This prevents user A from downloading user B's CBZ by guessing run ids.
   The run id itself acts as a capability token during the polling phase.

3. **`manga_data` is not touched** — the task writes to the normalized
   `manga` / `chapters` / `pages` tables per your schema. Your existing
   dashboard reads from the legacy `manga_data` flat table, so newly
   downloaded manga won't appear in the library table until you update
   `getMangaLibrary` / `getMangaStats` to read from the new schema. This
   is intentional — the schema migration is a separate concern. A sketch
   of the new queries:

   ```ts
   // Replace getMangaLibrary with something like:
   const { data } = await supabase
     .from("manga")
     .select(
       `
       id, title, slug, cover_url, chapter_count, created_at,
       chapters:chapters(id, chapter_number)
     `
     )
     .order("title", { ascending: true });
   ```

4. **First Trigger deploy** — run `npx trigger.dev@latest init` before
   your first `deploy`. It creates `trigger.config.ts` and links your
   local project to the Trigger.dev cloud project.

5. **WeebCentral now needs the `playwright` build extension deployed** —
   `trigger.config.ts` installs headless Chromium into the Trigger image
   at deploy time. If you `npx trigger.dev@latest deploy` and the
   extension was just added, expect a longer build (downloading the
   browser). Watch the build logs for the Chromium install step; if it's
   missing, the task will throw "Failed to launch Chromium" at runtime.

6. **Old `/api/v1/resolveWeebcentral` and `/api/v1/resolveManual` routes**
   — no longer called by the dashboard (resolution now happens inside
   the task). You can leave them in place or delete them. Both the route
   and the task-side scraper use Playwright, so don't remove the
   `playwright` dependency — it's required, not legacy.

7. **Idempotency on re-download** — the task deletes existing `chapters`
   - `pages` for a manga before re-inserting (handles mirror URL changes
     cleanly). The `manga` row is upserted. `download_history` is
     append-only — re-downloads add new rows with a fresh `downloaded_at`.

## Testing

Start with a **small manga** (5–10 chapters) to validate the pipeline
end to end. The Trigger.dev dashboard shows live logs + metadata, so
you can watch progress there in parallel with your UI.

After the first successful download, check Supabase:

- `select * from manga where title = '<your manga>';`
- `select count(*) from chapters where manga_id = '<id>';`
- `select count(*) from pages where chapter_id in (select id from chapters where manga_id = '<id>');`
- `select * from download_history where storage_path is not null order by downloaded_at desc limit 5;`
- Storage → cbz bucket → should see `<user_id>/<run_id>.cbz`
