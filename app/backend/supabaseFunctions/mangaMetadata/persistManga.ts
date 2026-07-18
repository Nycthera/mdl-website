// app/backend/supabaseFunctions/mangaMetadata/persistManga.ts
//
// Writes scraped catalog data (manga / chapters / pages) into Supabase.
//
// IMPORTANT: this only ever writes URLs — `pages.image_url` — never image
// bytes. The download-manga task calls this once scraping finishes; the
// build-cbz task later *reads* these rows back out and does the actual
// image downloading + zipping. That split is the whole point of the new
// two-stage pipeline: the slow, unreliable part (scraping a source for
// every page URL) is decoupled from the slow, unreliable part (fetching
// hundreds of images from scan mirrors), so either can be retried/rerun
// independently without redoing the other.
//
// A unique constraint on (source, source_manga_id) is added in
// supabase/migrations/0003_manga_dedupe_constraints.sql (see also
// 0002_manga_dedupe_cleanup.sql, which merges existing duplicates
// first), so manga rows
// are upserted via a real .upsert({ onConflict }) below instead of a
// manual select-then-insert/update. That manual pattern previously let
// two concurrent scrapes of the same series both pass the lookup and
// both insert, and also masked the sourceMangaId-drift bug fixed in
// download-manga.ts (see weebCentralChapterFallbackId).
import { createAdminClient } from "@/lib/supabase/server";
import { slugify } from "@/app/backend/utils";

export type MangaSource = "mangadex" | "weebcentral" | "manual";

export interface ScrapedChapter {
  /** Stable per-manga identifier, e.g. "0001", "0045.2". Also used as the
   *  human-readable chapter_number and as the CBZ folder suffix. */
  label: string;
  imageUrls: string[];
}

export interface ScrapedManga {
  source: MangaSource;
  sourceMangaId: string;
  title: string;
  coverUrl: string | null;
  chapters: ScrapedChapter[];
}

export interface PersistResult {
  mangaId: string;
  chapterCount: number;
  pageCount: number;
}

/** Finds an existing `manga` row for this (source, sourceMangaId), or
 *  creates one. Returns its id either way. */
async function upsertMangaRow(
  supabase: ReturnType<typeof createAdminClient>,
  scraped: Pick<
    ScrapedManga,
    "source" | "sourceMangaId" | "title" | "coverUrl"
  >,
): Promise<string> {
  const { data: upserted, error: upsertErr } = await supabase
    .from("manga")
    .upsert(
      {
        source: scraped.source,
        source_manga_id: scraped.sourceMangaId,
        title: scraped.title,
        slug: slugify(scraped.title),
        cover_url: scraped.coverUrl,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "source,source_manga_id" },
    )
    .select("id")
    .single();

  if (upsertErr || !upserted) {
    throw new Error(`manga upsert failed: ${upsertErr?.message}`);
  }

  return upserted.id as string;
}

/** Finds or creates a `chapters` row for (mangaId, label), then replaces
 *  all of its `pages` rows with the freshly scraped image URLs. Pages are
 *  fully replaced (not merged) so a re-download always reflects the
 *  latest page list for that chapter. */
async function upsertChapterWithPages(
  supabase: ReturnType<typeof createAdminClient>,
  mangaId: string,
  chapter: ScrapedChapter,
): Promise<{ chapterId: string; pageCount: number }> {
  const { data: upserted, error: upsertErr } = await supabase
    .from("chapters")
    .upsert(
      {
        manga_id: mangaId,
        source_chapter_id: chapter.label,
        chapter_number: chapter.label,
        page_count: chapter.imageUrls.length,
      },
      { onConflict: "manga_id,source_chapter_id" },
    )
    .select("id")
    .single();

  if (upsertErr || !upserted) {
    throw new Error(`chapter upsert failed: ${upsertErr?.message}`);
  }
  const chapterId = upserted.id as string;

  // Clear old pages before re-inserting — cheap since pages are just
  // (chapter_id, page_number, image_url) rows, no bytes involved. Safe to
  // run unconditionally now: a brand-new chapter simply has none to
  // delete.
  const { error: deleteErr } = await supabase
    .from("pages")
    .delete()
    .eq("chapter_id", chapterId);
  if (deleteErr) throw new Error(`page cleanup failed: ${deleteErr.message}`);

  if (chapter.imageUrls.length > 0) {
    const rows = chapter.imageUrls.map((imageUrl, index) => ({
      chapter_id: chapterId,
      page_number: index + 1,
      image_url: imageUrl,
    }));

    // Batch insert — Supabase/PostgREST handles arrays of a few thousand
    // rows fine in one call; chapters realistically top out well under that.
    const { error: pagesErr } = await supabase.from("pages").insert(rows);
    if (pagesErr) throw new Error(`page insert failed: ${pagesErr.message}`);
  }

  return { chapterId, pageCount: chapter.imageUrls.length };
}

/** Records that `userId` has a scrape for this manga, so
 *  /api/v1/download/urls's ownership check succeeds and the browser can
 *  look the manga back up by id to fetch its page URLs. Idempotent —
 *  reuses an existing row instead of creating a duplicate per re-download. */
async function ensureDownloadHistoryRow(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  mangaId: string,
): Promise<void> {
  const { data: existing, error: findErr } = await supabase
    .from("download_history")
    .select("id")
    .eq("user_id", userId)
    .eq("manga_id", mangaId)
    .limit(1)
    .maybeSingle();

  if (findErr) {
    throw new Error(`download_history lookup failed: ${findErr.message}`);
  }
  if (existing?.id) return;

  const { error: insertErr } = await supabase.from("download_history").insert({
    user_id: userId,
    manga_id: mangaId,
  });

  if (insertErr) {
    throw new Error(`download_history insert failed: ${insertErr.message}`);
  }
}

/**
 * Persists a full scrape result: the manga row, every chapter, and every
 * page's image URL — and records that `userId` now has access to build a
 * CBZ for it. Does NOT download or touch any image bytes.
 */
export async function persistScrapedManga(
  userId: string,
  scraped: ScrapedManga,
): Promise<PersistResult> {
  const supabase = createAdminClient();

  const mangaId = await upsertMangaRow(supabase, scraped);

  let pageCount = 0;
  for (const chapter of scraped.chapters) {
    const result = await upsertChapterWithPages(supabase, mangaId, chapter);
    pageCount += result.pageCount;
  }

  const { error: countErr } = await supabase
    .from("manga")
    .update({
      chapter_count: scraped.chapters.length,
      updated_at: new Date().toISOString(),
    })
    .eq("id", mangaId);
  if (countErr) {
    throw new Error(`manga chapter_count update failed: ${countErr.message}`);
  }

  await ensureDownloadHistoryRow(supabase, userId, mangaId);

  return {
    mangaId,
    chapterCount: scraped.chapters.length,
    pageCount,
  };
}
