// app/src/trigger/download-manga.ts
//
// Stage 1 of the download pipeline.
//
// This task NEVER fetches image bytes — it only resolves each chapter's
// list of page image URLs from the source (MangaDex API / WeebCentral
// HTML / scan-mirror guess-and-check) and writes them into
// `manga` / `chapters` / `pages` via persistScrapedManga. The actual
// downloading + zipping happens entirely client-side: the browser asks
// GET /api/v1/download/urls for the saved URLs, downloads each image,
// and zips them with fflate into a .cbz. No server-side build step.
import { task, metadata } from "@trigger.dev/sdk";

import { getMangaDexInfoFromURL, returnGlobFromURL } from "@/app/backend/utils";
import { makeResultsIntoArrayFormatForDownloadFunction } from "@/app/backend/mangadex/makeResultsIntoArrayFormatForDownloadFunction";
import { getCoverFromMangadex } from "@/app/backend/mangadex/scraping/getCoverFromMangadex";
import { findCoverImageURL } from "@/app/backend/manual/scrapping/getCoverImageURLFromManualURL";
import { gatherAllUrlsFromSample } from "@/app/backend/manual/scrapping/getAllImagesFromManual";
import { groupUrlsByChapter } from "@/app/backend/downloadLogicForManualAndWeebcentral/download";
import {
  isWeebCentralSeriesUrl,
  discoverSeriesUrlFromChapterPage,
  getWeebCentralSeriesChapters,
  getWeebCentralSeriesTitle,
  weebCentralSeriesSlug,
  slugToTitle,
} from "@/app/backend/weebcentral/scrapping/getSeriesChapterList";
import {
  fetchChapterImageUrls,
  fetchManualImages,
} from "@/app/backend/weebcentral/scrapping/getImageURLFromInputURL";
import {
  persistScrapedManga,
  type ScrapedChapter,
} from "@/app/backend/supabaseFunctions/mangaMetadata/persistManga";

export type DownloadSource = "mangadex" | "weebcentral" | "manual";

export interface DownloadMangaPayload {
  userId: string;
  url: string;
  source: DownloadSource;
}

export interface DownloadMangaOutput {
  mangaId: string;
  mangaName: string;
  chapterCount: number;
}

/** `/series/<id>/<slug>` -> `<id>`. Falls back to the whole path if the
 *  URL doesn't match the expected shape (still stable/unique per series). */
function weebCentralSeriesId(seriesUrl: string): string {
  try {
    const parts = new URL(seriesUrl).pathname.split("/").filter(Boolean);
    return parts[1] ?? seriesUrl;
  } catch {
    return seriesUrl;
  }
}

async function resolveMangaDex(url: string) {
  const { id, name } = getMangaDexInfoFromURL(url);

  metadata.set("mangaName", name);
  metadata.set("stage", "resolving-chapters");
  metadata.set("statusMessage", "Fetching chapter list from MangaDex...");

  const coverUrl = await getCoverFromMangadex(id).catch(() => null);

  const chapters: ScrapedChapter[] =
    await makeResultsIntoArrayFormatForDownloadFunction(url, (done, total) => {
      metadata.set(
        "progress",
        total > 0 ? Math.round((done / total) * 100) : 0,
      );
      metadata.set("statusMessage", `Resolved ${done}/${total} chapters...`);
    });

  return {
    sourceMangaId: id,
    title: name,
    coverUrl,
    chapters,
  };
}

async function resolveWeebCentral(url: string) {
  const seriesUrl = isWeebCentralSeriesUrl(url)
    ? url
    : await discoverSeriesUrlFromChapterPage(url);

  // No series link discoverable — fall back to single-chapter behavior
  // rather than failing the whole run.
  if (!seriesUrl) {
    metadata.set("statusMessage", "Resolving single chapter...");
    const { imageUrls, title } = await fetchManualImages(url);
    if (imageUrls.length === 0) {
      throw new Error("Could not resolve any pages for this WeebCentral URL");
    }
    return {
      sourceMangaId: title,
      title,
      coverUrl: imageUrls[0] ?? null,
      chapters: [{ label: "0001", imageUrls }] as ScrapedChapter[],
    };
  }

  metadata.set("stage", "resolving-chapters");
  metadata.set("statusMessage", "Fetching chapter list from WeebCentral...");

  const [title, chapterRefs] = await Promise.all([
    getWeebCentralSeriesTitle(seriesUrl),
    getWeebCentralSeriesChapters(seriesUrl),
  ]);

  // Title fallback chain:
  //   1. Real title scraped from the series page (best).
  //   2. URL slug, title-cased (e.g. "Aishiteru-Game-wo-Owarasetai" →
  //      "Aishiteru Game Wo Owarasetai"). Better than the ID because
  //      it's human-readable and matches what the .cbz filename should
  //      look like.
  //   3. Internal WeebCentral ID (worst — last resort when the URL has
  //      no slug, e.g. a bare /series/<id> with no trailing path).
  //
  // PREVIOUSLY this fell straight to (3), so a stale title selector on
  // WeebCentral's end caused the manga to be saved with its ID as the
  // title — and the client-side .cbz builder then named the file
  // "<id>.cbz" because that's what was in the DB. Falling back to the
  // slug first fixes that.
  const slug = weebCentralSeriesSlug(seriesUrl);
  const resolvedTitle =
    title ?? (slug ? slugToTitle(slug) : weebCentralSeriesId(seriesUrl));
  metadata.set("mangaName", resolvedTitle);

  const chapters: ScrapedChapter[] = [];
  let coverUrl: string | null = null;

  for (let i = 0; i < chapterRefs.length; i++) {
    const ref = chapterRefs[i];
    const imageUrls = await fetchChapterImageUrls(ref.url);

    if (imageUrls.length === 0) {
      // Mirrors the existing "skip a bad chapter, don't fail the whole
      // series" behavior used elsewhere in the scraping backend.
      continue;
    }

    if (!coverUrl) coverUrl = imageUrls[0];

    chapters.push({
      label: String(i + 1).padStart(4, "0"),
      imageUrls,
    });

    metadata.set("progress", Math.round(((i + 1) / chapterRefs.length) * 100));
    metadata.set(
      "statusMessage",
      `Resolved ${i + 1}/${chapterRefs.length} chapters...`,
    );
  }

  return {
    sourceMangaId: weebCentralSeriesId(seriesUrl),
    title: resolvedTitle,
    coverUrl,
    chapters,
  };
}

async function resolveManual(url: string) {
  const slug = returnGlobFromURL(url);
  if (!slug) throw new Error("Could not determine manga slug from URL");

  const title = slug
    .split(/[-_]/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");

  metadata.set("mangaName", title);
  metadata.set("stage", "resolving-pages");
  metadata.set("statusMessage", "Probing scan mirrors for pages...");

  const [coverUrl, flatUrls] = await Promise.all([
    findCoverImageURL(url).catch(() => null),
    gatherAllUrlsFromSample(url),
  ]);

  if (flatUrls.length === 0) {
    throw new Error("No chapters resolved for this manga");
  }

  const chapters = groupUrlsByChapter(flatUrls);

  return {
    sourceMangaId: slug,
    title,
    coverUrl,
    chapters: chapters as ScrapedChapter[],
  };
}

export const downloadManga = task({
  id: "download-manga",
  run: async (payload: DownloadMangaPayload): Promise<DownloadMangaOutput> => {
    const { userId, url, source } = payload;

    metadata.set("kind", "download-manga");
    metadata.set("progress", 0);
    metadata.set("stage", "starting");
    metadata.set("statusMessage", "Starting scrape...");

    const resolved =
      source === "mangadex"
        ? await resolveMangaDex(url)
        : source === "weebcentral"
          ? await resolveWeebCentral(url)
          : await resolveManual(url);

    if (resolved.chapters.length === 0) {
      throw new Error("No chapters could be resolved for this manga");
    }

    metadata.set("stage", "saving");
    metadata.set("statusMessage", "Saving chapter/page index...");
    metadata.set("progress", 95);

    // ── Save URLs ONLY — no image bytes are fetched here. ──────────────
    const { mangaId, chapterCount } = await persistScrapedManga(userId, {
      source,
      sourceMangaId: resolved.sourceMangaId,
      title: resolved.title,
      coverUrl: resolved.coverUrl,
      chapters: resolved.chapters,
    });

    metadata.set("progress", 100);
    metadata.set("stage", "done");
    metadata.set("statusMessage", "Scrape complete");
    metadata.set("mangaName", resolved.title);
    metadata.set("chapterCount", chapterCount);

    return {
      mangaId,
      mangaName: resolved.title,
      chapterCount,
    };
  },
});

/** Enqueues a download-manga run and returns its Trigger.dev run id. */
export async function enqueueDownload(
  payload: DownloadMangaPayload,
): Promise<string> {
  const handle = await downloadManga.trigger(payload);
  return handle.id;
}
