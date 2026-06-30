## Status: RESOLVED

Both issues below were fixed by replacing the synchronous `/api/v1/download/stream`
route with a `build-cbz` Trigger.dev task (`src/trigger/build-cbz.ts`) plus a thin
`/api/v1/download/build` route that just authorizes and enqueues it.

---

## Issue 1 (resolved)

`/api/v1/download/stream` used to generate and stream a CBZ inline during the HTTP
request (`maxDuration = 300`), including downloading every page image as part of
building the archive.

**Fix:** `/api/v1/download/build/route.ts` now only authenticates + authorizes the
request and calls `enqueueCbzBuild()`, returning `{ runId }` immediately. All page
fetching and archive building happens inside `buildCbzTask` (`src/trigger/build-cbz.ts`),
a Trigger.dev background task with no HTTP timeout ceiling. The finished `.cbz` is
uploaded to the private `cbz` Supabase Storage bucket; `/api/v1/jobs/[id]/route.ts`
mints a short-lived signed URL once the task completes, so the browser downloads
directly from Storage — our server never holds the connection open during the build.

The old `app/api/v1/download/stream/route.ts` has been deleted.

## Issue 2 (resolved)

The old streaming route treated "manga exists" as authorization when `download_history`
didn't prove ownership, letting any authenticated user fetch any manga by ID.

**Fix:** Ownership is now checked strictly against `download_history` (user_id + manga_id)
in two places:

- `/api/v1/download/build/route.ts` — returns `403` if no matching row, `500` if the
  lookup itself errors (no silent fallback to "row exists in `manga`").
- `buildCbzTask` re-checks the same condition independently before doing any work,
  as defense-in-depth against a forged/replayed run id.

No code path treats "manga exists in the `manga` table" as sufficient authorization
anymore.
