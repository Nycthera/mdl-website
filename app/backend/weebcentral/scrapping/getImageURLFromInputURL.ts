// app/backend/weebcentral/scrapping/getImageURLFromInputURL.ts
//
// FIX: WeebCentral's /chapters/<id> page ships with ZERO <img> tags in its
// initial HTML — verified directly against the live site. The page chrome
// (nav, login modal, page-number list, reading preferences) is server
// rendered, but the actual page images are injected into the DOM by
// client-side JS *after* load. A plain axios + cheerio fetch (the previous
// version of this file) only ever sees the pre-JS HTML, so `imageUrls` is
// always empty and the caller's "WeebCentral: no images found" check fires
// on every single run.
//
// This restores the Playwright-based approach (same as the working
// trigger.dev version of this file) — load the page in a real headless
// browser, scroll to trigger any lazy-loading, wait for the JS to settle,
// then read `<img>` elements out of the *live* DOM.
//
// IMPORTANT DEPLOYMENT NOTE: `playwright` must be a `dependency` (not just
// a `devDependency`) so it's installed in production, and if this runs
// inside a Trigger.dev task you need the Playwright build extension so the
// browser binaries are present in the deployed image. See trigger.config.ts.
import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserType,
} from "playwright";

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

// Try a few engines in case one isn't installed/available in the runtime.
const LAUNCH_ORDER: [string, BrowserType][] = [
  ["chromium", chromium],
  ["webkit", webkit],
  ["firefox", firefox],
];

async function launchAnyBrowser(): Promise<{ browser: Browser; name: string }> {
  let lastError: unknown;
  for (const [name, engine] of LAUNCH_ORDER) {
    try {
      const browser = await engine.launch({ headless: true });
      return { browser, name };
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(
    `Failed to launch any Playwright browser: ${String(lastError)}`
  );
}

// Lazy-loading attributes some image galleries use instead of (or in
// addition to) `src`. Keeping this list means we still pick up images even
// if WeebCentral changes how it promotes lazy images to `src`.
const ATTRS = ["src", "data-src", "data-lazy-src", "data-original"] as const;

/**
 * Loads the WeebCentral chapter page in a real (headless) browser and pulls
 * out every image URL that points at the scans mirrors (the
 * `/manga/<slug>/NNNN-NNN.png` pattern used by lastation.us / planeptune.us
 * / lowee.us). Real browser rendering is required because WeebCentral
 * injects the page images via client-side JS after the initial HTML loads.
 */
export async function fetchManualImages(url: string): Promise<ScrapeResult> {
  const { browser } = await launchAnyBrowser();

  try {
    const page = await browser.newPage({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
    });

    let response;
    try {
      response = await page.goto(url, { waitUntil: "load", timeout: 45000 });
    } catch {
      return { imageUrls: [], title: "Unknown_Title" };
    }

    if (!response || response.status() !== 200) {
      return { imageUrls: [], title: "Unknown_Title" };
    }

    // Wait for at least one manga page image to actually appear in the DOM
    // rather than relying purely on fixed timeouts. Falls through to the
    // scroll/timeout pass below regardless (some chapters lazy-load pages
    // further down the strip that won't be present yet).
    try {
      await page.waitForSelector(
        'img[src*="/manga/"], img[data-src*="/manga/"]',
        {
          timeout: 15000,
        }
      );
    } catch {
      // No luck within the timeout — keep going, the scroll loop below is
      // still worth attempting in case images load slowly.
    }

    // Scroll through the long-strip reader so lazy-loaded images further
    // down the page get triggered.
    for (let i = 0; i < 20; i++) {
      await page.mouse.wheel(0, 1200);
      await page.waitForTimeout(700);
    }

    // Let any in-flight lazy-loads settle.
    await page.waitForTimeout(4000);

    const imgElements = await page.$$("img");
    const seen = new Set<string>();
    const imageUrls: string[] = [];

    for (const img of imgElements) {
      for (const attr of ATTRS) {
        const raw = await img.getAttribute(attr);
        if (!raw) continue;
        try {
          const resolved = new URL(raw, url).toString();
          if (resolved.includes("/manga/") && resolved.endsWith(".png")) {
            if (!seen.has(resolved)) {
              seen.add(resolved);
              imageUrls.push(resolved);
            }
          }
        } catch {
          // ignore unparseable URLs
        }
        break; // first matching attribute wins for this element
      }
    }

    const title = extractTitleFromImageUrls(imageUrls);
    return { imageUrls, title };
  } finally {
    await browser.close();
  }
}
