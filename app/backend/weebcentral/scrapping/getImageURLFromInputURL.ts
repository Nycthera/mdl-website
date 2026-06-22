// app/backend/weebcentral/scrapping/getImageURLFromInputURL.ts
//
// REWRITTEN: Playwright is gone. WeebCentral's chapter pages serve the
// image URLs in the initial HTML (or in easily-reached data attributes),
// so a plain axios + cheerio scrape is enough — and crucially, this now
// runs anywhere (Vercel Lambda, Trigger task, local dev) without shipping
// a 300 MB browser binary.
//
// If WeebCentral ever moves fully behind JS lazy-loading and the initial
// HTML no longer contains the image URLs, fall back to running Playwright
// *inside* the Trigger task (Trigger supports custom Dockerfiles with
// system deps). But try this first — it almost certainly works.
import axios from "axios";
import * as cheerio from "cheerio";

const TITLE_PATTERN = /\/manga\/([^/]+)\//i;

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

const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://weebcentral.com/",
};

/**
 * Fetches the WeebCentral chapter page HTML and pulls out every image URL
 * that points at the scans mirrors (the `/manga/<slug>/NNNN-NNN.png`
 * pattern used by lastation.us / planeptune.us / lowee.us).
 *
 * Checks `src`, `data-src`, `data-lazy-src`, and `data-original` to cover
 * the common lazy-loading attribute names — so we catch images even when
 * the page hasn't run its JS to promote them to `src`.
 */
export async function fetchManualImages(url: string): Promise<ScrapeResult> {
  let html: string;
  try {
    const res = await axios.get<string>(url, {
      headers: REQUEST_HEADERS,
      timeout: 30000,
      responseType: "text",
      maxRedirects: 5,
    });
    html = res.data;
  } catch {
    return { imageUrls: [], title: "Unknown_Title" };
  }

  const $ = cheerio.load(html);

  // Candidate attributes that lazy-loaded image galleries use.
  const ATTRS = ["src", "data-src", "data-lazy-src", "data-original"];
  const seen = new Set<string>();
  const imageUrls: string[] = [];

  $("img").each((_, el) => {
    for (const attr of ATTRS) {
      const raw = $(el).attr(attr);
      if (!raw) continue;
      try {
        const resolved = new URL(raw, url).toString();
        // Same filter the old Playwright version used — only keep the
        // scans-mirror PNG URLs that the download pipeline knows how to
        // group into chapters.
        if (resolved.includes("/manga/") && resolved.endsWith(".png")) {
          if (!seen.has(resolved)) {
            seen.add(resolved);
            imageUrls.push(resolved);
          }
        }
      } catch {
        // ignore unparseable URLs
      }
    }
  });

  const title = extractTitleFromImageUrls(imageUrls);
  return { imageUrls, title };
}
