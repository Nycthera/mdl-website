/**
 * trigger/download-manga.ts
 *
 * Trigger.dev v4 task that replaces the old synchronous /api/v1/download
 * route.  The user-facing route just calls `downloadMangaTask.trigger()`
 * and returns the run id; this task does all the slow work in Trigger's
 * runtime (no Vercel timeout ceiling).
 *
 * Schema this task writes to (matching the user's existing Supabase design):
 *
 *   manga              — upserted, idempotent on (source, source_manga_id)
 *   chapters           — one row per chapter, FK → manga.id
 *   pages              — one row per page, FK → chapters.id
 *   download_history   — one row per chapter included in this CBZ download,
 *                        all sharing the same storage_path
 *   storage: cbz bucket — cbz/<user_id>/<run_id>.cbz
 *
 * Progress is published via `metadata.set("progress", ...)` so the
 * polling endpoint can read it back through `runs.retrieve()`.
 */
import { task, logger, metadata } from "@trigger.dev/sdk/v3";
import { createClient } from "@supabase/supabase-js";

import {
  buildMangaCbzBuffer,
  groupUrlsByChapter,
  type MangaChapterInput,
} from "@/app/backend/downloadLogicForManualAndWeebcentral/download";
import { gatherAllUrlsFromSample } from "@/app/backend/manual/scrapping/getAllImagesFromManual";
import { makeResultsIntoArrayFormatForDownloadFunction } from "@/app/backend/mangadex/makeResultsIntoArrayFormatForDownloadFunction";
import { fetchManualImages } from "@/app/backend/weebcentral/scrapping/getImageURLFromInputURL";
import { getMangaDexInfoFromURL, returnGlobFromURL } from "@/app/backend/utils";

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

  return createClient(url, serviceRoleKey, { auth: { persistSession: false } });
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
  retry: { maxAttempts: 2, factor: 2, minTimeoutInMs: 10_000 },
  run: async (payload: DownloadPayload, { ctx }) => {
    const db = supabaseAdmin();

    // ────────────────────────────────────────────────────────────────
    // 1. Resolve URL → { mangaName, chapters[] }
    // ────────────────────────────────────────────────────────────────
    logger.info("Resolving source", {
      source: payload.source,
      url: payload.url,
    });

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
        payload.url
      );
      // First page of first chapter as a cheap cover proxy.
      coverUrl = chapters[0]?.imageUrls[0] ?? null;
    } else if (payload.source === "manual") {
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
      // weebcentral — cheerio-based scrape (no Playwright). Returns image
      // URLs that match the manual mirror pattern.
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
        const chapterNumber = String(parseInt(chapter.label, 10) || i + 1);

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
    // 4. Download all images + zip into a CBZ buffer
    // ────────────────────────────────────────────────────────────────
    const buffer = await buildMangaCbzBuffer({
      mangaName,
      chapters,
      maxWorkers: 2,
      onProgress: (done, total) => {
        const pct = Math.round((done / total) * 100);
        metadata.set("progress", pct);
      },
    });

    logger.info("CBZ built", { sizeBytes: buffer.length });

    // ────────────────────────────────────────────────────────────────
    // 5. Upload to Supabase Storage
    // ────────────────────────────────────────────────────────────────
    const storagePath = `${payload.userId}/${ctx.run.id}.cbz`;

    {
      const { error } = await db.storage
        .from("cbz")
        .upload(storagePath, buffer, {
          contentType: "application/vnd.comicbook+zip",
          upsert: true,
        });
      if (error) throw error;
    }

    logger.info("Uploaded", { storagePath });

    // ────────────────────────────────────────────────────────────────
    // 6. Write download_history — one row per chapter in this download.
    //    All rows share the same storage_path (the manga-level CBZ).
    // ────────────────────────────────────────────────────────────────
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
          file_size: buffer.length,
          downloaded_at: now,
          storage_path: storagePath,
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

    // Return value is exposed via runs.retrieve().output — the polling
    // endpoint uses storagePath to mint a signed download URL.
    return {
      storagePath,
      mangaId,
      mangaName,
      chapterCount: chapters.length,
      fileSize: buffer.length,
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
