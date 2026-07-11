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
 * fabricated guess) if no selector matches — the caller falls back to the
 * URL slug.
 *
 * Tries multiple selectors in order, because WeebCentral has changed
 * their series-page HTML structure more than once and a single brittle
 * selector was silently returning null — which caused the manga to be
 * saved with its internal ID as the title (and the .cbz filename to be
 * that ID). The selector cascade below goes from most-specific to most-
 * generic, so a future HTML tweak is more likely to still hit one of
 * them.
 */
export async function getWeebCentralSeriesTitle(
  seriesUrl: string,
): Promise<string | null> {
  try {
    const html = await fetchWeebCentralHtml(seriesUrl);
    const $ = cheerio.load(html);

    // 1. Original selector — the Python reference's `section[x-data] >
    //    section:nth-of-type(2) h1`. Kept first because if WeebCentral
    //    hasn't changed, this is still the most precise match.
    let title = $("section[x-data] > section:nth-of-type(2) h1")
      .first()
      .text()
      .trim();
    if (title) return title;

    // 2. Broader: any h1 inside a section[x-data]. Catches cases where
    //    the inner section wrapper was removed/renamed but the outer
    //    section + h1 structure is intact.
    title = $("section[x-data] h1").first().text().trim();
    if (title) return title;

    // 3. Even broader: the first h1 on the page. WeebCentral's series
    //    page has exactly one prominent h1 (the title), so this is safe
    //    in practice — there's no other h1 competing for "first."
    title = $("h1").first().text().trim();
    if (title) return title;

    // 4. Last resort: parse the <title> tag. WeebCentral formats it as
    //    "<Manga Title> | WeebCentral" — strip the site suffix if
    //    present. This is the most fragile (depends on their <title>
    //    format) but better than returning null when the page clearly
    //    has a title somewhere.
    const rawTitle = $("title").first().text().trim();
    if (rawTitle) {
      const stripped = rawTitle
        .replace(/\s*\|\s*WeebCentral\s*$/i, "")
        .replace(/\s*-\s*WeebCentral\s*$/i, "")
        .trim();
      if (stripped) return stripped;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Title-cases a URL slug like "Aishiteru-Game-wo-Owarasetai" →
 * "Aishiteru Game Wo Owarasetai". Used as the fallback when the series
 * page scrape fails to find a title — better than using the internal ID
 * (which is what we used to fall back to and which produced .cbz files
 * named like "01J76XYFSMQKDN389B4FJ32VDH.cbz").
 *
 * "wo" stays lowercase per English title-case conventions for short
 * particles, but we don't bother — the user can rename the file. Point
 * is to produce something readable, not perfectly typeset.
 */
export function slugToTitle(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ")
    .trim();
}

/**
 * Extracts the slug portion of a WeebCentral series URL — the
 * human-readable tail after the ID. For
 *   https://weebcentral.com/series/01J76XYFSMQKDN389B4FJ32VDH/Aishiteru-Game-wo-Owarasetai
 * this returns "Aishiteru-Game-wo-Owarasetai". Returns null if the URL
 * doesn't have a slug (e.g. bare /series/<id> with no trailing path).
 */
export function weebCentralSeriesSlug(seriesUrl: string): string | null {
  try {
    const parts = new URL(seriesUrl).pathname.split("/").filter(Boolean);
    // parts = ["series", "<id>", "<slug>"]
    if (parts.length >= 3 && parts[2]) return parts[2];
    return null;
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
