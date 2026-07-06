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
// No unique constraint exists on (source, source_manga_id) or
// (manga_id, source_chapter_id) in the current schema, so this does a
// manual select-then-insert/update instead of relying on `.upsert()`.
import { createAdminClient } from "@/lib/supabase/server";

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
  const { data: existing, error: findErr } = await supabase
    .from("manga")
    .select("id")
    .eq("source", scraped.source)
    .eq("source_manga_id", scraped.sourceMangaId)
    .limit(1)
    .maybeSingle();

  if (findErr) throw new Error(`manga lookup failed: ${findErr.message}`);

  if (existing?.id) {
    const { error: updateErr } = await supabase
      .from("manga")
      .update({
        title: scraped.title,
        cover_url: scraped.coverUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);

    if (updateErr) throw new Error(`manga update failed: ${updateErr.message}`);

    return existing.id as string;
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("manga")
    .insert({
      source: scraped.source,
      source_manga_id: scraped.sourceMangaId,
      title: scraped.title,
      cover_url: scraped.coverUrl,
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    throw new Error(`manga insert failed: ${insertErr?.message}`);
  }

  return inserted.id as string;
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
  const { data: existing, error: findErr } = await supabase
    .from("chapters")
    .select("id")
    .eq("manga_id", mangaId)
    .eq("source_chapter_id", chapter.label)
    .limit(1)
    .maybeSingle();

  if (findErr) throw new Error(`chapter lookup failed: ${findErr.message}`);

  let chapterId: string;

  if (existing?.id) {
    chapterId = existing.id as string;
    const { error: updateErr } = await supabase
      .from("chapters")
      .update({
        chapter_number: chapter.label,
        page_count: chapter.imageUrls.length,
      })
      .eq("id", chapterId);
    if (updateErr)
      throw new Error(`chapter update failed: ${updateErr.message}`);

    // Clear old pages before re-inserting — cheap since pages are just
    // (chapter_id, page_number, image_url) rows, no bytes involved.
    const { error: deleteErr } = await supabase
      .from("pages")
      .delete()
      .eq("chapter_id", chapterId);
    if (deleteErr) throw new Error(`page cleanup failed: ${deleteErr.message}`);
  } else {
    const { data: inserted, error: insertErr } = await supabase
      .from("chapters")
      .insert({
        manga_id: mangaId,
        source_chapter_id: chapter.label,
        chapter_number: chapter.label,
        page_count: chapter.imageUrls.length,
      })
      .select("id")
      .single();

    if (insertErr || !inserted) {
      throw new Error(`chapter insert failed: ${insertErr?.message}`);
    }
    chapterId = inserted.id as string;
  }

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

/** Records that `userId` has a scrape (and, later, a build) for this
 *  manga, so /api/v1/download/build's ownership check succeeds and the
 *  build-cbz task can look the manga back up by id. Idempotent — reuses
 *  an existing row instead of creating a duplicate per re-download. */
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
