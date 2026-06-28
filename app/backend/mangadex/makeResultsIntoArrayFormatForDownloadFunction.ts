import {
  getChapterImagesFromMangaDex,
  getAllChapterIDsForMangaDex,
} from "@/app/backend/mangadex/scraping/getChapterImagesFromMangadex";
import { getMangaDexInfoFromURL } from "@/app/backend/utils";

interface MangaChapterInput {
  label: string;
  imageUrls: string[];
}

/** Bounded-concurrency map.  For MangaDex chapter resolution we MUST use
 *  concurrency 1 — `mangaDexFetch`'s 220ms pacing gate is process-global,
 *  but it only works for serial requests.  Running 5 workers concurrently
 *  defeats the gate (they all fire in the same tick after waiting 220ms)
 *  and triggers MangaDex's 5-req/s burst limiter, which returns 429 with
 *  a 60s retry-after.  That's exactly the 5-minute stall at the start of
 *  every MangaDex download we saw in the Trigger.dev trace. */
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

export async function makeResultsIntoArrayFormatForDownloadFunction(
  mangaUrl: string,
  onProgress?: (done: number, total: number) => void
): Promise<MangaChapterInput[]> {
  const manga = getMangaDexInfoFromURL(mangaUrl);

  const chapterIds = await getAllChapterIDsForMangaDex(manga.id);

  let done = 0;
  // FIX: concurrency 1 for MangaDex.  See the comment on
  // mapWithConcurrency above — anything higher defeats the 220ms pacing
  // gate in mangaDexFetch and triggers a 429 storm that adds 5+ minutes
  // to every MangaDex download.  Serial at 220ms/req is ~4.5 req/s,
  // safely under MangaDex's 5 req/s limit, and 213 chapters resolves in
  // ~47s instead of 5+ minutes.
  const chapters = await mapWithConcurrency(
    chapterIds,
    1,
    async (chapterId, i) => {
      const chapterImages = await getChapterImagesFromMangaDex(chapterId);
      done++;
      onProgress?.(done, chapterIds.length);
      return {
        label: String(i + 1).padStart(4, "0"),
        imageUrls: chapterImages.fullUrls,
      };
    }
  );

  return chapters;
}
