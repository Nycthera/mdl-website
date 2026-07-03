/**
 * trigger/download-manga.ts
 *
 * Trigger.dev v4 task that replaces the old synchronous /api/v1/download
 * route.  The user-facing route just calls `downloadMangaTask.trigger()`
 * and returns the run id; this task does all the slow work in Trigger's
 * runtime (no Vercel timeout ceiling).
 *
 * METADATA-ONLY MODE — no CBZ file is built and nothing is uploaded to
 * Supabase Storage.  The task only resolves the source, then writes
 * catalog rows into the existing normalized schema:
 *
 *   manga              — upserted, idempotent on (source, source_manga_id)
 *   chapters           — one row per chapter, FK → manga.id
 *   pages              — one row per page (image URL only), FK → chapters.id
 *   download_history   — one row per chapter, no storage_path / file_size
 *
 * Because no image bytes are downloaded, the task finishes in seconds
 * (previously it hung for hours trying to fetch 1000+ images without
 * the required Referer/User-Agent headers, which the scan-mirror CDNs
 * reject with 403/404).
 *
 * Progress is published via `metadata.set("progress", ...)` so the
 * polling endpoint can read it back through `runs.retrieve()`.
 */
import { task, logger, metadata } from "@trigger.dev/sdk";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";

import {
  groupUrlsByChapter,
  type MangaChapterInput,
} from "@/app/backend/downloadLogicForManualAndWeebcentral/download";
import { gatherAllUrlsFromSample } from "@/app/backend/manual/scrapping/getAllImagesFromManual";
import { makeResultsIntoArrayFormatForDownloadFunction } from "@/app/backend/mangadex/makeResultsIntoArrayFormatForDownloadFunction";
import {
  fetchManualImages,
  fetchChapterImageUrls,
} from "@/app/backend/weebcentral/scrapping/getImageURLFromInputURL";
import {
  isWeebCentralSeriesUrl,
  getWeebCentralSeriesChapters,
  getWeebCentralSeriesTitle,
  discoverSeriesUrlFromChapterPage,
} from "@/app/backend/weebcentral/scrapping/getSeriesChapterList";
import { getMangaDexInfoFromURL, returnGlobFromURL } from "@/app/backend/utils";

/** Bounded-concurrency map — same minimal pattern used elsewhere in this
 *  codebase (e.g. mangadex chapter resolution). Runs `fn` over `items`
 *  with at most `limit` in flight at once. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  return results;
}

export type DownloadSource = "mangadex" | "manual" | "weebcentral";

export interface DownloadPayload {
  /** auth.users.id — used for storage path scoping + RLS. */
  userId: string;
  /** Raw URL the user pasted. */
  url: string;
  source: DownloadSource;
}

/** Row shape for the `manga` table upsert. */
interface MangaRow {
  id?: string;
  source: DownloadSource;
  source_manga_id: string;
  title: string;
  slug: string;
  cover_url: string | null;
  description: string | null;
  chapter_count: number;
}

/** Build a service-role Supabase client. Bypasses RLS — only run server-side. */
function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars"
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
    realtime: { transport: ws },
  });
}

/** Title-case a slug like "wistoria-wand-and-sword" → "Wistoria Wand And Sword". */
function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Pull the slug out of a scans-mirror image URL: .../manga/<slug>/0001-001.png → <slug>. */
function slugFromImageUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length >= 2 && parts[0] === "manga") return parts[1];
  } catch {
    // Malformed URL — fall through and let the caller use its own fallback.
  }
  return null;
}

export const downloadMangaTask = task({
  id: "download-manga",
  // Long manga can take a while; allow up to 1 hour. Trigger lets you go
  // much higher than Vercel's 300s ceiling.
  maxDuration: 3600,
  // NOTE: every network call inside this task already has its own
  // timeout + retry loop (mangaDexFetch, fetchImageBuffer, checkUrl).
  // Retrying the *whole task* on top of that means a failure near the
  // end of a long download (e.g. one image that never recovers) throws
  // away hours of completed work and starts the entire resolve+download
  // from scratch — which is what made runs look like they "never stop."
  // One attempt is enough; the inner retry logic does the real work.
  retry: { maxAttempts: 1 },
  run: async (payload: DownloadPayload) => {
    const db = supabaseAdmin();

    // ────────────────────────────────────────────────────────────────
    // 1. Resolve URL → { mangaName, chapters[] }
    // ────────────────────────────────────────────────────────────────
    logger.info("Resolving source", {
      source: payload.source,
      url: payload.url,
    });

    metadata.set("kind", "download-manga");
    metadata.set("stage", "resolving");
    metadata.set("statusMessage", "Looking up manga details...");
    metadata.set("progress", 0);

    let mangaName: string;
    let slug: string;
    let sourceMangaId: string;
    let coverUrl: string | null;
    let chapters: MangaChapterInput[];

    if (payload.source === "mangadex") {
      const info = getMangaDexInfoFromURL(payload.url);
      mangaName = info.name;
      slug = info.id; // mangadex slug is the UUID; use id for both
      sourceMangaId = info.id;
      chapters = await makeResultsIntoArrayFormatForDownloadFunction(
        payload.url,
        (done, total) => {
          metadata.set(
            "statusMessage",
            `Resolving chapters (${done}/${total})...`
          );
        }
      );
      // First page of first chapter as a cheap cover proxy.
      coverUrl = chapters[0]?.imageUrls[0] ?? null;
    } else if (payload.source === "manual") {
      metadata.set("statusMessage", "Scanning mirror for chapters...");
      const pageUrls = await gatherAllUrlsFromSample(payload.url);
      if (pageUrls.length === 0) {
        throw new Error("No chapters found for this manga");
      }
      chapters = groupUrlsByChapter(pageUrls);
      slug = returnGlobFromURL(payload.url) ?? "unknown-manga";
      sourceMangaId = slug;
      mangaName = titleFromSlug(slug);
      coverUrl = pageUrls[0] ?? null;
    } else {
      // weebcentral — fetches `<chapter_url>/images?reading_style=long_strip`
      // over plain HTTP (server-rendered, no JS needed) to get the first
      // image, then guesses & checks the rest of the chapter's pages
      // against that same scan-mirror CDN. See getImageURLFromInputURL.ts
      // for the full writeup — this no longer needs a headless browser.
      //
      // THE FIX for "only downloads a single chapter": this used to call
      // fetchManualImages() on whatever one chapter URL the user pasted
      // and stop there. Now we try to discover the SERIES that chapter
      // belongs to (or use it directly if the user pasted a series URL),
      // fetch the full chapter list, and resolve every chapter's pages —
      // same as the mangadex/manual flows already did.
      metadata.set("statusMessage", "Looking up series...");

      const seriesUrl = isWeebCentralSeriesUrl(payload.url)
        ? payload.url
        : await discoverSeriesUrlFromChapterPage(payload.url);

      if (seriesUrl) {
        const seriesChapters = await getWeebCentralSeriesChapters(seriesUrl);

        if (seriesChapters.length === 0) {
          throw new Error(
            "WeebCentral: could not find any chapters for this series"
          );
        }

        metadata.set(
          "statusMessage",
          `Found ${seriesChapters.length} chapters. Resolving pages...`
        );

        const allImageUrls: string[] = [];
        let resolvedCount = 0;

        // Bounded concurrency: each chapter itself fans out into several
        // mirror probes, so 4 chapters at once is plenty without hammering
        // the mirrors. One bad/missing chapter just contributes zero pages
        // instead of failing the whole series.
        await mapWithConcurrency(seriesChapters, 4, async (ch) => {
          try {
            const urls = await fetchChapterImageUrls(ch.url);
            allImageUrls.push(...urls);
          } catch (err) {
            logger.warn("Failed to resolve a chapter, skipping it", {
              chapter: ch.name,
              error: err instanceof Error ? err.message : String(err),
            });
          } finally {
            resolvedCount++;
            metadata.set(
              "statusMessage",
              `Resolving chapters (${resolvedCount}/${seriesChapters.length})...`
            );
          }
        });

        if (allImageUrls.length === 0) {
          throw new Error("WeebCentral: no images found across any chapter");
        }

        chapters = groupUrlsByChapter(allImageUrls);
        const inferredSlug = slugFromImageUrl(allImageUrls[0]);
        slug = inferredSlug ?? "unknown-manga";
        sourceMangaId = slug;
        const seriesTitle = await getWeebCentralSeriesTitle(seriesUrl);
        mangaName = seriesTitle ?? titleFromSlug(slug);
        coverUrl = allImageUrls[0] ?? null;
      } else {
        // Couldn't find a series link on the chapter page — fall back to
        // downloading just that one chapter rather than failing outright.
        logger.warn(
          "Could not discover a series link from the chapter page; " +
            "downloading only the single chapter that was provided."
        );
        metadata.set(
          "statusMessage",
          "Couldn't find the series — downloading just this chapter..."
        );
        const { imageUrls, title } = await fetchManualImages(payload.url);
        if (imageUrls.length === 0) {
          throw new Error("WeebCentral: no images found");
        }
        chapters = groupUrlsByChapter(imageUrls);
        const inferredSlug = slugFromImageUrl(imageUrls[0]);
        slug = inferredSlug ?? title;
        sourceMangaId = slug;
        mangaName = title !== "Unknown_Title" ? title : titleFromSlug(slug);
        coverUrl = imageUrls[0] ?? null;
      }
    }

    logger.info("Resolved", {
      mangaName,
      slug,
      chapterCount: chapters.length,
      totalPages: chapters.reduce((n, c) => n + c.imageUrls.length, 0),
    });

    metadata.set("mangaName", mangaName);
    metadata.set("slug", slug);
    metadata.set("chapterCount", chapters.length);
    metadata.set("progress", 0);

    if (chapters.length === 0) {
      throw new Error("No chapters resolved for this manga");
    }

    // ────────────────────────────────────────────────────────────────
    // 2. Upsert manga row (idempotent on source + source_manga_id)
    // ────────────────────────────────────────────────────────────────
    const mangaRow: Omit<MangaRow, "id"> = {
      source: payload.source,
      source_manga_id: sourceMangaId,
      title: mangaName,
      slug,
      cover_url: coverUrl,
      description: null,
      chapter_count: chapters.length,
    };

    const { data: upsertedManga, error: mangaErr } = await db
      .from("manga")
      .upsert(mangaRow, { onConflict: "source,source_manga_id" })
      .select("id")
      .single();

    if (mangaErr || !upsertedManga) {
      throw new Error(
        `Failed to upsert manga: ${mangaErr?.message ?? "unknown"}`
      );
    }
    const mangaId = upsertedManga.id;
    logger.info("Manga row ready", { mangaId });

    // ────────────────────────────────────────────────────────────────
    // 3. Insert chapters + pages
    //
    // Idempotent: delete existing children first, then re-insert. Cheaper
    // than per-row upserts and avoids needing unique constraints on
    // (manga_id, source_chapter_id) which the existing schema doesn't
    // guarantee. The page URLs may have changed (mirror moves), so a full
    // refresh is the safer call.
    // ────────────────────────────────────────────────────────────────
    metadata.set("stage", "saving_metadata");
    metadata.set("statusMessage", "Saving chapter list...");
    // Track the highest real-world chapter number we insert below — used
    // to populate manga_data.latest_chapter_local after this block.
    let maxChapterNumber = 0;
    await (async () => {
      // 3a. Find existing chapter ids for this manga, then delete their
      // pages + the chapters themselves.
      const { data: existingChapters } = await db
        .from("chapters")
        .select("id")
        .eq("manga_id", mangaId);

      if (existingChapters && existingChapters.length > 0) {
        const chapterIds = existingChapters.map((c: { id: string }) => c.id);
        await db.from("pages").delete().in("chapter_id", chapterIds);
        await db.from("chapters").delete().eq("manga_id", mangaId);
      }

      // 3b. Insert new chapters + pages, one chapter at a time so we can
      // capture each chapter's id for its pages.
      for (let i = 0; i < chapters.length; i++) {
        const chapter = chapters[i];
        // FIX: parseInt("0049.1") truncates to 49, losing the decimal —
        // wrong for split chapters like 49.1/49.2. parseFloat preserves it
        // while still stripping the zero-padding for display.
        const parsed = parseFloat(chapter.label);
        const chapterNumberValue = Number.isFinite(parsed) ? parsed : i + 1;
        const chapterNumber = String(chapterNumberValue);
        if (chapterNumberValue > maxChapterNumber) {
          maxChapterNumber = chapterNumberValue;
        }

        const { data: chapterRow, error: chapterErr } = await db
          .from("chapters")
          .insert({
            manga_id: mangaId,
            source_chapter_id: chapter.label, // e.g. "0001"
            chapter_number: chapterNumber,
            chapter_title: `Chapter ${chapterNumber}`,
            page_count: chapter.imageUrls.length,
          })
          .select("id")
          .single();

        if (chapterErr || !chapterRow) {
          logger.error("Failed to insert chapter, skipping", {
            chapter: chapter.label,
            error: chapterErr?.message,
          });
          continue;
        }

        // Insert all pages for this chapter in one batch.
        const pageRows = chapter.imageUrls.map((imageUrl, idx) => ({
          chapter_id: chapterRow.id,
          page_number: idx + 1,
          image_url: imageUrl,
        }));

        const { error: pagesErr } = await db.from("pages").insert(pageRows);
        if (pagesErr) {
          logger.error("Failed to insert pages for chapter", {
            chapter: chapter.label,
            error: pagesErr.message,
          });
        }
      }
    })();

    logger.info("Metadata written", { mangaId, chapterCount: chapters.length });

    // ────────────────────────────────────────────────────────────────
    // 4. Upsert manga_data — powers the dashboard's "Library" table and
    //    "Up to date / Behind" stats. This is a separate, legacy-shaped
    //    table (keyed by manga_name, not manga_id) that predates the
    //    normalized manga/chapters/pages schema above, so it's written
    //    independently here rather than joined from it.
    //
    //    LIMITATION: for non-MangaDex sources (manual scan mirrors,
    //    WeebCentral) there's no MangaDex lookup wired up yet to know
    //    what MangaDex's *actual* latest chapter is, so
    //    latest_chapter_from_mangadex is set equal to latest_chapter_local
    //    here — i.e. "up to date" by definition at download time. A
    //    future "check for updates" job could look the title up on
    //    MangaDex independently and refresh this column without
    //    re-downloading. For MangaDex downloads this is NOT a limitation:
    //    step 1 above already resolved MangaDex's full current chapter
    //    list, so the two numbers are genuinely equal right now and will
    //    only diverge once MangaDex publishes new chapters after this run.
    // ────────────────────────────────────────────────────────────────
    metadata.set("statusMessage", "Updating library status...");
    const { error: mangaDataErr } = await db.from("manga_data").upsert(
      {
        manga_name: mangaName,
        date_last_checked: Math.floor(Date.now() / 1000),
        latest_chapter_local: maxChapterNumber,
        latest_chapter_from_mangadex: maxChapterNumber,
      },
      { onConflict: "manga_name" }
    );

    if (mangaDataErr) {
      logger.error("Failed to upsert manga_data", {
        error: mangaDataErr.message,
      });
    }

    // ────────────────────────────────────────────────────────────────
    // 5. Write download_history — one row per chapter in this download.
    //
    //    METADATA-ONLY MODE: no CBZ is built, nothing is uploaded to
    //    Supabase Storage, so the rows carry no storage_path / file_size.
    //    The previous image-download + storage-upload steps were removed
    //    because (a) `fetchImageBuffer` was sending no Referer/User-Agent
    //    headers, so every mirror CDN request returned 403/404 and the
    //    task hung for hours in retry loops, and (b) the user explicitly
    //    asked to stop uploading CBZ files to Supabase Storage.
    // ────────────────────────────────────────────────────────────────
    metadata.set("stage", "finalizing");
    metadata.set("statusMessage", "Recording download history...");
    await (async () => {
      // Re-fetch the chapter ids we just inserted so download_history
      // rows can FK to them.
      const { data: chapterRows, error: chapterFetchErr } = await db
        .from("chapters")
        .select("id, source_chapter_id")
        .eq("manga_id", mangaId);

      if (chapterFetchErr || !chapterRows) {
        logger.error("Failed to fetch chapter ids for history", {
          error: chapterFetchErr?.message,
        });
        return;
      }

      const now = new Date().toISOString();
      const historyRows = chapterRows.map(
        (c: { id: string; source_chapter_id: string }) => ({
          user_id: payload.userId,
          manga_id: mangaId,
          chapter_id: c.id,
          downloaded_at: now,
          // Intentionally omitted: file_size + storage_path.  No CBZ
          // is produced in metadata-only mode.
        })
      );

      const { error: historyErr } = await db
        .from("download_history")
        .insert(historyRows);

      if (historyErr) {
        logger.error("Failed to write download_history", {
          error: historyErr.message,
        });
      }
    })();

    metadata.set("progress", 100);
    metadata.set("stage", "completed");
    metadata.set("statusMessage", "Done!");

    // Return value is exposed via runs.retrieve().output.  No storagePath
    // is returned — the polling endpoint no longer mints signed URLs.
    return {
      mangaId,
      mangaName,
      chapterCount: chapters.length,
    };
  },
});

/**
 * Convenience wrapper for the API route. Returns the Trigger run id, which
 * the frontend uses for polling.
 */
export async function enqueueDownload(
  payload: DownloadPayload
): Promise<string> {
  const run = await downloadMangaTask.trigger(payload);
  return run.id;
}
