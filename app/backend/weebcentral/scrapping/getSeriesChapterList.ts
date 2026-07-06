// app/backend/weebcentral/scrapping/getSeriesChapterList.ts
//
// THE ACTUAL FIX for "only downloads a single chapter worth of images":
// the system only ever fetched ONE chapter's images for WeebCentral,
// because download-manga.ts called fetchManualImages() on whatever single
// chapter URL the user pasted and never looked for sibling chapters.
//
// validateMangaURL (app/backend/utils.ts) already expects the user to
// paste a single `/chapters/<id>` URL for WeebCentral — the intent was
// clearly "give us any chapter, we'll grab the whole manga," but that
// series-wide discovery step was never implemented. This file adds it:
//
//   1. `discoverSeriesUrlFromChapterPage` — given a bare chapter URL,
//      fetches its plain HTML and looks for a link back to the series
//      page (WeebCentral chapter pages link back to their series in the
//      header/breadcrumb, same as most manga readers).
//   2. `getWeebCentralSeriesChapters` — given a series URL, fetches
//      WeebCentral's dedicated chapter-list endpoint and returns every
//      chapter (oldest first), translated from the Python reference's
//      `get_chapters()` (same `div[x-data] > a` / `span.flex > span`
//      selectors, same "build from first 3 path segments" URL pattern).
//   3. `getWeebCentralSeriesTitle` — best-effort title lookup from the
//      series page itself, translated from `get_manga_title()`.
import * as cheerio from "cheerio";
import { fetchWeebCentralHtml } from "@/app/backend/weebcentral/scrapping/weebcentralHttp";

const BASE_URL = "https://weebcentral.com";

export interface WeebCentralChapterRef {
  url: string;
  name: string;
}

export function isWeebCentralSeriesUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    return parsed.hostname === "weebcentral.com" && parts[0] === "series";
  } catch {
    return false;
  }
}

/**
 * Builds the chapter-list endpoint from a series URL, mirroring the
 * Python reference's `get_chapter_list_url`:
 *   path = urlparse(url).path; parts = path.split("/")
 *   chapter_list_path = "/".join(parts[:3]) + "/full-chapter-list"
 * i.e. only the `/series/<id>` portion matters — the trailing slug is
 * dropped.
 */
function getChapterListUrl(seriesUrl: string): string {
  const parsed = new URL(seriesUrl);
  const parts = parsed.pathname.split("/").filter(Boolean); // ["series", "<id>", "<slug>"]
  return `${BASE_URL}/${parts.slice(0, 2).join("/")}/full-chapter-list`;
}

/**
 * Fetches every chapter URL + display name for a series, oldest first.
 * Translated from the Python reference's `get_chapters()`.
 */
export async function getWeebCentralSeriesChapters(
  seriesUrl: string,
): Promise<WeebCentralChapterRef[]> {
  const listUrl = getChapterListUrl(seriesUrl);
  const html = await fetchWeebCentralHtml(listUrl);

  const $ = cheerio.load(html);
  const chapters: WeebCentralChapterRef[] = [];

  $("div[x-data] > a").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    const nameEl = $(el).find("span.flex > span").first();
    const name = nameEl.text().trim() || "Unknown Chapter";

    const url = href.startsWith("http") ? href : `${BASE_URL}${href}`;
    chapters.push({ url, name });
  });

  // WeebCentral lists newest-first; reverse so chapter 1 is first, matching
  // the Python reference and the order our pipeline expects.
  return chapters.reverse();
}

/**
 * Best-effort manga title from the series page itself. Translated from
 * the Python reference's `get_manga_title()`. Returns null (rather than a
 * fabricated guess) if the selector doesn't match — the caller already has
 * a slug-based fallback.
 */
export async function getWeebCentralSeriesTitle(
  seriesUrl: string,
): Promise<string | null> {
  try {
    const html = await fetchWeebCentralHtml(seriesUrl);
    const $ = cheerio.load(html);
    const title = $("section[x-data] > section:nth-of-type(2) h1")
      .first()
      .text()
      .trim();
    return title || null;
  } catch {
    return null;
  }
}

/**
 * Given a bare `/chapters/<id>` URL, tries to find the series it belongs
 * to by looking for the first link back to a `/series/<id>/<slug>` page
 * anywhere in that chapter's plain HTML (WeebCentral's chapter pages link
 * back to their series in the header/breadcrumb — this is the first such
 * link on the page, well before any "related series" widgets further
 * down). Returns null if no such link is found, so callers can fall back
 * to single-chapter behavior instead of failing outright.
 */
export async function discoverSeriesUrlFromChapterPage(
  chapterUrl: string,
): Promise<string | null> {
  try {
    const html = await fetchWeebCentralHtml(chapterUrl);
    const match = html.match(/href="(\/series\/[^"]+)"/i);
    if (!match) return null;
    return `${BASE_URL}${match[1]}`;
  } catch {
    return null;
  }
}
