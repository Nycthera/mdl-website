// app/backend/manual/scrapping/mirrorProbe.ts
//
// Shared "guess and check" page-probing logic against the scan-mirror CDNs
// (lastation/lowee/planeptune). Originally lived only inside
// getAllImagesFromManual.ts for the "manual" source, but the WeebCentral
// flow links to these same mirrors — once we have ONE known-good image URL
// for a chapter (the "first image"), we can reuse the exact same
// sticky-mirror + batched probing approach to find the rest of the pages
// instead of re-rendering the page with a browser.
import axios from "axios";

export const MIRROR_BASE_URLS = [
  "https://scans.lastation.us/manga/",
  "https://official.lowee.us/manga/",
  "https://hot.planeptune.us/manga/",
  "https://scans-hot.planeptune.us/manga/",
];

const client = axios.create({
  timeout: 8000,
  validateStatus: () => true,
});

export const MIRROR_REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  Referer: "https://mangadex.org/",
  Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
};

/** Single GET against one candidate URL. Returns true on 2xx-3xx, false otherwise (incl. network errors/timeouts). */
export async function checkMirrorUrl(url: string): Promise<boolean> {
  try {
    const res = await client.get(url, {
      responseType: "stream",
      headers: MIRROR_REQUEST_HEADERS,
    });
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  }
}

/** Races all known mirrors for one candidate path, returns the first working full URL or null if all fail. */
export async function findWorkingMirrorUrl(
  candidates: string[],
): Promise<string | null> {
  try {
    return await Promise.any(
      candidates.map(async (url) => {
        const ok = await checkMirrorUrl(url);
        if (ok) return url;
        throw new Error("not found");
      }),
    );
  } catch {
    return null;
  }
}

/** Given a known mirror base URL (e.g. "https://scans.lastation.us/manga/"),
 *  return which entry of MIRROR_BASE_URLS it matches, if any. */
export function mirrorBaseFromUrl(url: string): string | null {
  return MIRROR_BASE_URLS.find((base) => url.startsWith(base)) ?? null;
}

/**
 * Probes pages `startPage..maxPages` of one chapter against the scan
 * mirrors, given a manga slug + zero-padded chapter string (e.g. "0049" or
 * "0049.1" for decimal chapters). Sticks to `stickyBaseIn` (a known-good
 * mirror base) when given, re-racing all mirrors only when the sticky one
 * misses — same trade-off as the original "manual" source logic.
 *
 * Pages are probed in small concurrent batches rather than one at a time,
 * falling back to a precise per-page multi-mirror race only when a batch
 * entry misses, so correctness (stopping exactly where the chapter ends)
 * is unchanged but the common case (lots of existing pages) is much faster.
 */
export async function probeChapterPages(
  mangaName: string,
  chapterStr: string,
  startPage: number,
  stickyBaseIn: string | null,
  maxPages = 100,
  batchSize = 5,
): Promise<{ urls: string[]; stickyBase: string | null }> {
  const urls: string[] = [];
  let stickyBase = stickyBaseIn;

  let page = startPage;
  pageLoop: while (page <= maxPages) {
    const batchEnd = Math.min(page + batchSize - 1, maxPages);
    const batchPages = Array.from(
      { length: batchEnd - page + 1 },
      (_, idx) => page + idx,
    );

    const batchResults = stickyBase
      ? await Promise.all(
          batchPages.map(async (p) => {
            const pageStr = p.toString().padStart(3, "0");
            const candidate = `${stickyBase}${mangaName}/${chapterStr}-${pageStr}.png`;
            return (await checkMirrorUrl(candidate)) ? candidate : null;
          }),
        )
      : batchPages.map(() => null);

    for (let idx = 0; idx < batchPages.length; idx++) {
      const p = batchPages[idx];
      let pageUrl = batchResults[idx];

      if (!pageUrl) {
        const pageStr = p.toString().padStart(3, "0");
        const pageRelative = `${mangaName}/${chapterStr}-${pageStr}.png`;

        pageUrl = await findWorkingMirrorUrl(
          MIRROR_BASE_URLS.map((base) => `${base}${pageRelative}`),
        );

        if (pageUrl) {
          stickyBase = mirrorBaseFromUrl(pageUrl) ?? stickyBase;
        } else {
          // All mirrors agree this page doesn't exist — end of chapter.
          break pageLoop;
        }
      }

      urls.push(pageUrl);
    }

    page = batchEnd + 1;
  }

  return { urls, stickyBase };
}
