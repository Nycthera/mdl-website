/**
 * trigger/build-cbz.ts
 *
 * Trigger.dev task that replaces the old behaviour of
 * /api/v1/download/stream, which used to download every page image and
 * build the .cbz archive *inside the HTTP request handler* (with
 * `maxDuration = 300` as a workaround). That meant:
 *   - The heavy MangaDex/scan-mirror fetching ran in a Vercel function,
 *     subject to its timeout ceiling, instead of in a background worker.
 *   - "Streaming the payload directly" was being used as a way to dodge
 *     the timeout instead of actually moving the work off the request.
 *
 * Now: the route just authorizes the request and calls
 * `buildCbzTask.trigger()`, returning `202` with the run id. This task
 * does all the slow work (fetch chapters/pages from the DB, download
 * every page image, zip them into a .cbz, upload the result) with no
 * HTTP timeout ceiling at all.
 *
 * Output is uploaded to the private `cbz` Supabase Storage bucket at
 * `<userId>/<runId>.cbz` (bucket + RLS policies already defined in
 * supabase/migrations/20260622000000_trigger_migration.sql). The polling
 * endpoint (/api/v1/jobs/:id) mints a short-lived signed URL once this
 * task completes — the browser downloads straight from Storage, not
 * through our server.
 */
import { task, logger, metadata } from "@trigger.dev/sdk";
import { createClient } from "@supabase/supabase-js";
import type { WebSocketLikeConstructor } from "@supabase/realtime-js";
import ws from "ws";

import {
  buildMangaCbzBuffer,
  getCbzFilename,
  type MangaChapterInput,
} from "@/app/backend/downloadLogicForManualAndWeebcentral/download";

// ──────────────────────────────────────────────────────────────────────────
// WebSocket polyfill for @supabase/realtime-js on Node.js < 22
//
// Trigger.dev's prod worker runs Node.js 21, which has no native
// `globalThis.WebSocket`. @supabase/realtime-js v2.108.2 unconditionally
// constructs a RealtimeClient inside `new SupabaseClient(...)`, and that
// constructor calls `WebSocketFactory.getWebSocketConstructor()` whenever
// `realtime.transport` is nullish — throwing
//   "Node.js 21 detected without native WebSocket support."
// before you can make a single REST call.
//
// Two layers of defense:
//   1. `trigger.config.ts` marks `ws` as external + installs it via
//      `additionalPackages`, so `import ws from "ws"` resolves to the
//      real WebSocket class at runtime (esbuild bundling `ws` produces
//      an undefined default export because `ws`'s optional native deps
//      `bufferutil` / `utf-8-validate` aren't installed in the worker).
//   2. Belt-and-suspenders: assign `ws` to `globalThis.WebSocket` so
//      `WebSocketFactory.detectEnvironment()` returns
//      `{ type: 'native', wsConstructor: ws }` even if the
//      `realtime: { transport: ws }` option is somehow lost in a future
//      supabase-js upgrade. This task never subscribes to a channel, so
//      the polyfill is never actually used to open a socket — it just
//      has to exist so the constructor doesn't throw.
//
// `ws`'s constructor signature (`new (url, options?: ClientOptions)`) is
// runtime-compatible with `WebSocketLikeConstructor`
// (`new (url, subprotocols?: string|string[])`) — supabase only ever
// invokes it with a single URL argument — but the static types don't
// overlap, so we cast through `unknown`.
// ──────────────────────────────────────────────────────────────────────────
const wsTransport = ws as unknown as WebSocketLikeConstructor;

if (
  typeof (globalThis as { WebSocket?: unknown }).WebSocket === "undefined" &&
  typeof ws !== "undefined"
) {
  (globalThis as { WebSocket: WebSocketLikeConstructor }).WebSocket =
    wsTransport;
}

export interface BuildCbzPayload {
  /** auth.users.id of the user who requested this archive — used both for
   *  the storage path scoping and as a defense-in-depth ownership check. */
  userId: string;
  mangaId: string;
}

interface ChapterRow {
  id: string;
  source_chapter_id: string;
}

interface PageRow {
  chapter_id: string;
  page_number: number;
  image_url: string;
}

/** Build a service-role Supabase client. Bypasses RLS — only run server-side,
 *  inside the Trigger.dev worker, never exposed to the browser. */
function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars"
    );
  }

  // Defensive: if `ws` is undefined here it means either (a) trigger.config.ts
  // `external`/`additionalPackages` was reverted, or (b) the build is bundling
  // `ws` again. Fail loudly with an actionable message instead of letting
  // @supabase/realtime-js throw the misleading "Node.js 21 detected without
  // native WebSocket support" error from deep inside its constructor.
  if (!ws) {
    throw new Error(
      "ws package failed to load at runtime. Ensure trigger.config.ts has " +
        "`external: ['ws']` and `additionalPackages({ packages: ['ws'] })`."
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
    realtime: { transport: wsTransport },
  });
}

export const buildCbzTask = task({
  id: "build-cbz",
  // Same reasoning as download-manga.ts: long manga can take a while, and
  // Trigger has no Vercel-style ceiling. One attempt — the per-image fetch
  // already has its own retry/timeout logic, so retrying the whole task
  // would throw away a lot of completed downloading work for one bad image.
  maxDuration: 3600,
  retry: { maxAttempts: 1 },
  run: async (payload: BuildCbzPayload, { ctx }) => {
    const db = supabaseAdmin();
    const runId = ctx.run.id;

    metadata.set("kind", "build-cbz");
    metadata.set("stage", "authorizing");
    metadata.set("progress", 0);

    // ── 1. Defense-in-depth ownership check ───────────────────────────
    // The route already checks this before triggering the task, but the
    // task re-checks independently — never trust a single layer to be the
    // only thing standing between a user and someone else's archive.
    // STRICT: a download_history row scoped to this exact user is the only
    // accepted proof of access. No "row exists in `manga`" fallback.
    const { data: ownership, error: ownershipErr } = await db
      .from("download_history")
      .select("id")
      .eq("user_id", payload.userId)
      .eq("manga_id", payload.mangaId)
      .limit(1);

    if (ownershipErr) {
      throw new Error(
        `Ownership check failed: ${ownershipErr.message} — refusing to build archive`
      );
    }
    if (!ownership || ownership.length === 0) {
      throw new Error(
        "Forbidden: no download_history row for this user/manga — refusing to build archive"
      );
    }
    logger.info("✓ ownership confirmed", {
      userId: payload.userId,
      mangaId: payload.mangaId,
    });

    // ── 2. Load manga + chapters + pages from the DB ──────────────────
    metadata.set("stage", "loading_metadata");
    metadata.set("statusMessage", "Loading chapter list...");

    const { data: manga, error: mangaErr } = await db
      .from("manga")
      .select("title, source")
      .eq("id", payload.mangaId)
      .single();

    if (mangaErr || !manga) {
      throw new Error(`Manga not found: ${mangaErr?.message ?? "no row"}`);
    }
    const mangaSource = (manga as { source: string }).source;

    const { data: chapters, error: chaptersErr } = await db
      .from("chapters")
      .select("id, source_chapter_id, chapter_number")
      .eq("manga_id", payload.mangaId)
      .order("chapter_number", { ascending: true });

    if (chaptersErr || !chapters || chapters.length === 0) {
      throw new Error(
        `No chapters found for this manga: ${chaptersErr?.message ?? ""}`
      );
    }

    const chapterIds = (chapters as ChapterRow[]).map((c) => c.id);
    const BATCH_SIZE = 50;
    const allPages: PageRow[] = [];

    for (let i = 0; i < chapterIds.length; i += BATCH_SIZE) {
      const batch = chapterIds.slice(i, i + BATCH_SIZE);
      const { data: batchPages, error: pagesErr } = await db
        .from("pages")
        .select("chapter_id, page_number, image_url")
        .in("chapter_id", batch)
        .order("page_number", { ascending: true });

      if (pagesErr) {
        throw new Error(`Failed to fetch pages: ${pagesErr.message}`);
      }
      if (batchPages) allPages.push(...(batchPages as PageRow[]));
    }

    if (allPages.length === 0) {
      throw new Error("No pages found for this manga");
    }

    const pagesByChapter = new Map<string, PageRow[]>();
    for (const page of allPages) {
      const arr = pagesByChapter.get(page.chapter_id);
      if (arr) arr.push(page);
      else pagesByChapter.set(page.chapter_id, [page]);
    }

    const chapterInputs: MangaChapterInput[] = (chapters as ChapterRow[])
      .map((ch) => {
        const pages = pagesByChapter.get(ch.id) ?? [];
        return {
          label: ch.source_chapter_id,
          imageUrls: pages
            .sort((a, b) => a.page_number - b.page_number)
            .map((p) => p.image_url),
        };
      })
      .filter((ch) => ch.imageUrls.length > 0);

    if (chapterInputs.length === 0) {
      throw new Error("No chapters with pages found after grouping");
    }

    const totalImages = chapterInputs.reduce(
      (n, c) => n + c.imageUrls.length,
      0
    );
    logger.info("✓ metadata loaded", {
      chapters: chapterInputs.length,
      totalImages,
    });
    metadata.set("chapterCount", chapterInputs.length);

    // ── 3. Download every page + build the .cbz in memory ─────────────
    metadata.set("stage", "downloading");
    const maxWorkers = mangaSource === "mangadex" ? 3 : 8;

    const cbzBuffer = await buildMangaCbzBuffer({
      mangaName: manga.title,
      chapters: chapterInputs,
      maxWorkers,
      onProgress: (done, total) => {
        // Reserve the last 10% of the progress bar for the finalize +
        // upload steps below, so it doesn't look "stuck at 100%".
        const pct = Math.min(90, Math.round((done / total) * 90));
        metadata.set("progress", pct);
        metadata.set(
          "statusMessage",
          `Downloading pages (${done}/${total})...`
        );
      },
      onFinalizing: () => {
        metadata.set("stage", "finalizing");
        metadata.set("statusMessage", "Packaging archive...");
        metadata.set("progress", 92);
      },
    });

    logger.info("✓ cbz built", { bytes: cbzBuffer.byteLength });

    // ── 4. Upload to the private `cbz` storage bucket ─────────────────
    metadata.set("stage", "uploading");
    metadata.set("statusMessage", "Uploading archive...");
    metadata.set("progress", 95);

    const storagePath = `${payload.userId}/${runId}.cbz`;
    const { error: uploadErr } = await db.storage
      .from("cbz")
      .upload(storagePath, cbzBuffer, {
        contentType: "application/vnd.comicbook+zip",
        upsert: true,
      });

    if (uploadErr) {
      throw new Error(`Failed to upload archive: ${uploadErr.message}`);
    }
    logger.info("✓ uploaded", { storagePath });

    // ── 5. Record storage_path on the matching download_history rows ──
    // Best-effort — a failure here shouldn't fail the whole run, since the
    // archive is already uploaded and downloadable via the signed URL the
    // polling endpoint mints from `storagePath` in this task's output.
    const { error: historyUpdateErr } = await db
      .from("download_history")
      .update({ storage_path: storagePath })
      .eq("user_id", payload.userId)
      .eq("manga_id", payload.mangaId);

    if (historyUpdateErr) {
      logger.error("Failed to record storage_path on download_history", {
        error: historyUpdateErr.message,
      });
    }

    metadata.set("stage", "completed");
    metadata.set("statusMessage", "Done!");
    metadata.set("progress", 100);

    return {
      mangaId: payload.mangaId,
      userId: payload.userId,
      filename: getCbzFilename(manga.title),
      storagePath,
    };
  },
});

/** Convenience wrapper for the API route. Returns the Trigger run id. */
export async function enqueueCbzBuild(
  payload: BuildCbzPayload
): Promise<string> {
  const run = await buildCbzTask.trigger(payload);
  return run.id;
}
