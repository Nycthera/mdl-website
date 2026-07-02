import { returnGlobFromURL } from "@/app/backend/utils";
import {
  MIRROR_BASE_URLS,
  checkMirrorUrl,
  findWorkingMirrorUrl,
  mirrorBaseFromUrl,
  probeChapterPages,
} from "@/app/backend/manual/scrapping/mirrorProbe";

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
      const ok = await checkMirrorUrl(candidate);
      firstPageUrl = ok ? candidate : null;
    }

    if (!firstPageUrl) {
      // Sticky mirror missed (or we don't have one yet) — race all 4 to
      // find out if the series moved mirrors or this chapter doesn't exist.
      firstPageUrl = await findWorkingMirrorUrl(
        MIRROR_BASE_URLS.map((base) => `${base}${firstPageRelative}`)
      );

      if (firstPageUrl) {
        stickyBase = mirrorBaseFromUrl(firstPageUrl) ?? stickyBase;
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

    // Fetch all remaining pages of this chapter, sticking to the
    // known-good mirror (shared logic — also used by the WeebCentral flow).
    const rest = await probeChapterPages(
      mangaName,
      chapterStr,
      2,
      stickyBase,
      maxPages
    );
    urls.push(...rest.urls);
    stickyBase = rest.stickyBase;
  }

  return urls;
}
