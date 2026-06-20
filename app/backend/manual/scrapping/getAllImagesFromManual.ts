import axios from "axios";
import { returnGlobFromURL } from "@/app/backend/utils";

const baseUrls = [
  "https://scans.lastation.us/manga/",
  "https://official.lowee.us/manga/",
  "https://hot.planeptune.us/manga/",
  "https://scans-hot.planeptune.us/manga/",
];

const client = axios.create({
  timeout: 8000,
  validateStatus: () => true,
});

const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  Referer: "https://mangadex.org/",
  Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
};

/** Single GET against one candidate URL. Returns true on 2xx-3xx, false otherwise (incl. network errors/timeouts). */
async function checkUrl(url: string): Promise<boolean> {
  try {
    const res = await client.get(url, {
      responseType: "stream",
      headers: REQUEST_HEADERS,
    });
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  }
}

/** Races all 4 mirrors for one candidate path, returns the first working full URL or null if all fail. */
async function findWorkingUrl(candidates: string[]): Promise<string | null> {
  try {
    return await Promise.any(
      candidates.map(async (url) => {
        const ok = await checkUrl(url);
        if (ok) return url;
        throw new Error("not found");
      })
    );
  } catch {
    return null;
  }
}

export async function gatherAllUrlsFromSample(
  sampleUrl: string,
  maxChapters = 2000,
  maxPages = 100,
  maxConsecutiveMisses = 3
): Promise<string[]> {
  const mangaName = returnGlobFromURL(sampleUrl);
  if (!mangaName) throw new Error("Invalid manga URL");

  const urls: string[] = [];
  let consecutiveMisses = 0;

  // Sticky mirror: once we find a base URL that has this series, keep using
  // it directly (no racing all 4) until it 404s, then re-probe all 4 to see
  // if it's a real miss (end of chapter/series) or just that mirror dropping it.
  let stickyBase: string | null = null;

  for (let chapter = 1; chapter <= maxChapters; chapter++) {
    const chapterStr = chapter.toString().padStart(4, "0");
    const firstPageRelative = `${mangaName}/${chapterStr}-001.png`;

    let firstPageUrl: string | null = null;

    if (stickyBase) {
      // Try the known-good mirror directly first — no racing.
      const candidate = `${stickyBase}${firstPageRelative}`;
      const ok = await checkUrl(candidate);
      firstPageUrl = ok ? candidate : null;
    }

    if (!firstPageUrl) {
      // Sticky mirror missed (or we don't have one yet) — race all 4 to
      // find out if the series moved mirrors or this chapter doesn't exist.
      firstPageUrl = await findWorkingUrl(
        baseUrls.map((base) => `${base}${firstPageRelative}`)
      );

      if (firstPageUrl) {
        // Lock in whichever base URL just worked.
        const matchedBase = baseUrls.find((base) =>
          firstPageUrl!.startsWith(base)
        );
        stickyBase = matchedBase ?? stickyBase;
      }
    }

    if (!firstPageUrl) {
      consecutiveMisses++;
      // Only treat the manga as "ended" after several chapters in a row
      // fail to resolve on ALL mirrors — a single miss is more likely a
      // flaky mirror (timeout/rate-limit) than proof the chapter doesn't exist.
      if (consecutiveMisses >= maxConsecutiveMisses) break;
      continue;
    }
    consecutiveMisses = 0;

    urls.push(firstPageUrl);

    // Fetch all remaining pages, sticking to the known-good mirror.
    for (let page = 2; page <= maxPages; page++) {
      const pageStr = page.toString().padStart(3, "0");
      const pageRelative = `${mangaName}/${chapterStr}-${pageStr}.png`;

      let pageUrl: string | null = null;

      if (stickyBase) {
        const candidate = `${stickyBase}${pageRelative}`;
        const ok = await checkUrl(candidate);
        pageUrl = ok ? candidate : null;
      }

      if (!pageUrl) {
        // Sticky mirror missed — could be end of chapter, or the mirror
        // dropped mid-chapter. Re-race all 4 to be sure before giving up
        // on this page (and thus this chapter).
        pageUrl = await findWorkingUrl(
          baseUrls.map((base) => `${base}${pageRelative}`)
        );

        if (pageUrl) {
          const matchedBase = baseUrls.find((base) =>
            pageUrl!.startsWith(base)
          );
          stickyBase = matchedBase ?? stickyBase;
        } else {
          // All 4 mirrors agree this page doesn't exist — end of chapter.
          break;
        }
      }

      urls.push(pageUrl);
    }
  }

  return urls;
}
