// app/backend/weebcentral/scrapping/getImageURLFromInputURL.ts
//
// Per-CHAPTER image resolution for WeebCentral. Fetches
// `<chapter_url>/images?reading_style=long_strip` — a server-rendered
// endpoint that already contains every page's <img src> in the initial
// HTML, confirmed against the user's Python reference implementation's
// `get_chapter_images()`. No headless browser needed.
//
// We only trust the FIRST image found on that page as an anchor (manga
// slug + chapter number + which scan-mirror it lives on), then hand off to
// `probeChapterPages` (shared with the "manual" source) to guess-and-check
// the rest of that chapter's pages directly against the mirror, rather
// than trusting every link WeebCentral's page happens to render.
//
// For resolving an entire SERIES (all chapters), see
// getSeriesChapterList.ts — this file only ever handles one chapter at a
// time.
import * as cheerio from "cheerio";
import { fetchWeebCentralHtml } from "@/app/backend/weebcentral/scrapping/weebcentralHttp";
import {
  checkMirrorUrl,
  mirrorBaseFromUrl,
  probeChapterPages,
} from "@/app/backend/manual/scrapping/mirrorProbe";

const TITLE_PATTERN = /\/manga\/([^/]+)\//i;
// e.g. ".../manga/Some-Manga/0049.1-001.png" -> chapter "0049.1", page "001"
const MIRROR_IMAGE_PATTERN = /\/manga\/[^/]+\/(\d{4}(?:\.\d+)?)-(\d{3})\.png$/i;

export interface ScrapeResult {
  imageUrls: string[];
  title: string;
}

function extractTitleFromImageUrls(imageUrls: string[]): string {
  for (const url of imageUrls) {
    const match = url.match(TITLE_PATTERN);
    if (match) return match[1];
  }
  return "Unknown_Title";
}

/**
 * Resolves every page's mirror URL for ONE WeebCentral chapter. Loads
 * `<chapter_url>/images?reading_style=long_strip` (plain HTTP), grabs the
 * first scan-mirror image URL it finds, and uses that single URL to anchor
 * a guess-and-check pass over the rest of the chapter's pages on that same
 * mirror. Returns an empty array (never throws on "not found") so a
 * series-wide download can skip one bad chapter without failing the whole
 * run.
 */
export async function fetchChapterImageUrls(
  chapterUrl: string
): Promise<string[]> {
  const imagesUrl = `${chapterUrl.replace(/\/+$/, "")}/images?reading_style=long_strip`;
  const html = await fetchWeebCentralHtml(imagesUrl);

  const $ = cheerio.load(html);
  const candidateUrls: string[] = [];
  $("img").each((_, el) => {
    const src = $(el).attr("src");
    if (src && !src.includes("broken_image") && src.startsWith("http")) {
      candidateUrls.push(src);
    }
  });

  // Anchor on the first URL that actually matches the mirror's
  // <slug>/<chapter>-<page>.png pattern — the page may also contain
  // unrelated chrome (icons/logos) that happen to start with http.
  let firstImageUrl: string | null = null;
  let mangaSlug = "";
  let chapterStr = "";
  let firstPageNum = 1;

  for (const candidate of candidateUrls) {
    const match = candidate.match(MIRROR_IMAGE_PATTERN);
    if (match) {
      firstImageUrl = candidate;
      chapterStr = match[1];
      firstPageNum = parseInt(match[2], 10) || 1;
      const slugMatch = candidate.match(TITLE_PATTERN);
      mangaSlug = slugMatch ? slugMatch[1] : "";
      break;
    }
  }

  if (!firstImageUrl || !mangaSlug) return [];

  // Double-check the anchor image is actually reachable before trusting it
  // as the basis for guessing the rest of the chapter.
  const reachable = await checkMirrorUrl(firstImageUrl);
  if (!reachable) return [];

  const stickyBase = mirrorBaseFromUrl(firstImageUrl);
  const { urls: restUrls } = await probeChapterPages(
    mangaSlug,
    chapterStr,
    firstPageNum + 1,
    stickyBase,
    100
  );

  return [firstImageUrl, ...restUrls];
}

/** Single-chapter entry point (back-compat / fallback when a series link
 *  can't be discovered from a bare chapter URL — see download-manga.ts). */
export async function fetchManualImages(url: string): Promise<ScrapeResult> {
  const imageUrls = await fetchChapterImageUrls(url);
  if (imageUrls.length === 0) return { imageUrls: [], title: "Unknown_Title" };
  return { imageUrls, title: extractTitleFromImageUrls(imageUrls) };
}
