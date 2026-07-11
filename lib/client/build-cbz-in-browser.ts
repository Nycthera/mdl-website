// lib/client/build-cbz-in-browser.ts
//
// Client-side replacement for the old server-side build-cbz Trigger task.
//
// The server no longer builds a .cbz and uploads it to Supabase Storage.
// Instead the browser:
//   1. asks /api/v1/download/urls for the list of page image URLs already
//      saved during the scrape (no image bytes ever live server-side);
//   2. fetches each image — direct from the CDN when the CDN sends CORS
//      headers (uploads.mangadex.org does), or through /api/v1/proxy/image
//      when it doesn't (scan-mirror CDNs like official.lowee.us);
//   3. zips the bytes in-browser with `fflate` (store-only — same as the
//      server used to do, since images are already compressed);
//   4. triggers a .cbz download via a Blob URL.
//
// The .cbz layout (chapter_XXXX/<filename>) matches what the old
// server-side buildMangaCbzBuffer produced, so existing readers won't
// notice the difference. The proxy fallback is the only piece of server
// involvement for image bytes — it exists solely because browser fetch
// can't set User-Agent / Referer (forbidden headers) and scan-mirror CDNs
// 403/404 bare requests + don't send Access-Control-Allow-Origin.
import { zipSync, type Zippable } from "fflate";

/** Shape returned by GET /api/v1/download/urls?mangaId=... */
export interface UrlsResponse {
  mangaId: string;
  mangaName: string;
  chapterCount: number;
  totalPages: number;
  chapters: Array<{
    label: string;
    folder: string;
    imageUrls: string[];
  }>;
}

/** Progress callback — fires after each image finishes (success or fail). */
export interface BuildProgress {
  /** Images downloaded so far. */
  done: number;
  /** Total images to download. */
  total: number;
  /** Images that failed to download (and will be skipped). */
  failed: number;
  /** Human-readable status line for the UI. */
  statusMessage: string;
}

/**
 * Mirror of the same logic in download.ts (filenameFromUrl), but
 * client-side. Falls back to a 3-digit page index if the URL has no
 * usable basename — keeps CBZ readers happy with stable ordering.
 */
function filenameFromUrl(url: string, fallbackIndex: number): string {
  try {
    const base = new URL(url).pathname.split("/").pop();
    if (base && base.includes(".")) return base;
  } catch {
    // ignore
  }
  return `${String(fallbackIndex).padStart(3, "0")}.png`;
}

/** Mirrors sanitizeFolderName() in download.ts. */
function sanitizeMangaName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Concurrency-limited map — same pattern as mapWithConcurrency in
 *  download.ts, just Promise-based and browser-side. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
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
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

/**
 * Hosts known to block CORS (direct browser fetch failed).
 *
 * Once a host lands in here, we skip the direct attempt and route every
 * subsequent request to that host through /api/v1/proxy/image. This
 * avoids the wasted round-trip of trying direct first on a host we
 * already know won't work.
 *
 * MangaDex's image server (uploads.mangadex.org) sends
 * `Access-Control-Allow-Origin: *`, so it never lands here — those
 * downloads go straight from the CDN to the browser without touching
 * our server. The scan-mirror CDNs (official.lowee.us,
 * scans.lastation.us, hot.planeptune.us, ...) don't send CORS headers,
 * so after the first image fails they're added here and all remaining
 * pages route through the proxy.
 */
const corsBlockedHosts = new Set<string>();

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

/** Builds the proxy URL for a given image URL. The proxy route fetches
 *  the image server-side (with proper User-Agent + Referer, which the
 *  browser can't set) and streams it back with
 *  `Access-Control-Allow-Origin: *`. */
function proxyUrlFor(url: string): string {
  return `/api/v1/proxy/image?url=${encodeURIComponent(url)}`;
}

/** Direct browser fetch — works for CDNs that send CORS headers
 *  (uploads.mangadex.org). Returns the ArrayBuffer on success, throws
 *  on any failure (CORS, network, non-2xx). Single attempt only —
 *  retries are handled by the caller. */
async function fetchDirectOnce(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, {
    // Browser fetch can't set User-Agent / Referer — those are
    // forbidden headers. The CDN must accept the request based on
    // Origin alone.
    signal: AbortSignal.timeout(20_000),
    // Don't send cookies — these are third-party CDNs.
    credentials: "omit",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return await response.arrayBuffer();
}

/** Fetches via the server-side proxy with retry + backoff. The proxy
 *  handles CORS (sets `Access-Control-Allow-Origin: *` on the response)
 *  and sends the right User-Agent + Referer upstream, so this works for
 *  CDNs that block bare browser requests. */
async function fetchViaProxy(
  url: string,
  maxRetries: number,
): Promise<ArrayBuffer> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(proxyUrlFor(url), {
        signal: AbortSignal.timeout(30_000),
        credentials: "same-origin",
      });

      if (response.status === 429) {
        const retryAfter =
          Number(response.headers.get("retry-after")) || attempt * 5;
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.arrayBuffer();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const delay = Math.min(800 * Math.pow(2, attempt - 1), 8_000);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw new Error(
    `Failed to download ${url} after ${maxRetries} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

/**
 * Fetches a single image as ArrayBuffer, trying direct first and
 * falling back to the server-side proxy when the host blocks CORS.
 *
 * Strategy per host:
 *   - If we've never tried this host before: attempt a direct fetch.
 *     If it works, great — no server bandwidth used. If it fails (CORS,
 *     network, whatever), mark the host as CORS-blocked and retry via
 *     the proxy.
 *   - If the host is already known to block CORS: skip the direct
 *     attempt entirely and go straight to the proxy.
 *
 * This gives us the best of both worlds: MangaDex images go direct
 * (CDN → browser, no server involvement), scan-mirror images go through
 * the proxy (CDN → our server → browser, with proper headers + CORS).
 */
async function fetchImageArrayBuffer(
  url: string,
  maxRetries = 3,
): Promise<ArrayBuffer> {
  const host = hostnameOf(url);

  // Fast path: host is already known to block CORS — go straight to
  // the proxy without wasting a round-trip on a direct attempt.
  if (corsBlockedHosts.has(host)) {
    return fetchViaProxy(url, maxRetries);
  }

  // Try direct first. Single attempt — if it fails for any reason
  // (CORS, network, non-2xx), we mark the host and retry via proxy.
  try {
    return await fetchDirectOnce(url);
  } catch (directErr) {
    // Don't log here for every page — once we've classified the host,
    // subsequent pages skip direct entirely. Log once per host instead.
    if (!corsBlockedHosts.has(host)) {
      corsBlockedHosts.add(host);
      console.info(
        `[build-cbz] Host ${host} blocks direct fetch (CORS or network) — routing through proxy for the rest of this build.`,
        directErr instanceof Error ? directErr.message : directErr,
      );
    }
    return fetchViaProxy(url, maxRetries);
  }
}

/**
 * Fetches page URLs from the server, downloads every image in the
 * browser, zips them into a .cbz, and triggers a download of the
 * resulting Blob.
 *
 * @param mangaId  The manga to build (must already be scraped + saved).
 * @param onProgress  Optional progress callback (called after every image).
 * @returns Metadata about the build (filename, byte size, pages downloaded).
 */
export async function buildAndDownloadCbz(
  mangaId: string,
  onProgress?: (p: BuildProgress) => void,
): Promise<{
  filename: string;
  bytes: number;
  totalPages: number;
  failedPages: number;
}> {
  // ── 1. Fetch the page URLs from the server ──────────────────────────
  // The server owns the auth + ownership check; we just read the URLs.
  const urlsRes = await fetch(
    `/api/v1/download/urls?mangaId=${encodeURIComponent(mangaId)}`,
  );

  if (!urlsRes.ok) {
    const err = (await urlsRes.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(err.error ?? `Failed to fetch URLs (${urlsRes.status})`);
  }

  const data: UrlsResponse = await urlsRes.json();

  if (data.totalPages === 0) {
    throw new Error("No pages to download for this manga");
  }

  // ── 2. Build the flat job list (same shape as server-side jobs in
  //       download.ts: one entry per image, with its in-zip path). ──────
  const jobs: Array<{ url: string; arcname: string }> = [];
  let pageIndex = 0;
  for (const chapter of data.chapters) {
    for (const url of chapter.imageUrls) {
      jobs.push({
        url,
        arcname: `${chapter.folder}/${filenameFromUrl(url, pageIndex++)}`,
      });
    }
  }
  // Sort within each chapter by filename, matching the server's
  // sorted(files) convention so the page order is stable.
  jobs.sort((a, b) => a.arcname.localeCompare(b.arcname));

  // ── 3. Download every image with bounded concurrency ────────────────
  // We track failures separately so one bad page doesn't kill the whole
  // archive — the user still gets a .cbz with everything that worked,
  // and we report how many pages were missing.
  const entries: Zippable = {};
  let done = 0;
  let failed = 0;

  await mapWithConcurrency(jobs, 6, async (job) => {
    try {
      const buf = await fetchImageArrayBuffer(job.url);
      // `store: true` — same as the server used to do. Images are
      // already compressed; re-compressing them just burns CPU for
      // ~1-2% size reduction and makes the browser stall.
      entries[job.arcname] = [new Uint8Array(buf), { level: 0 }];
    } catch (err) {
      failed++;
      // Log to console for debugging — the user will see a per-page
      // miss count in the toast at the end.
      console.warn(`Failed to download ${job.url}:`, err);
    }
    done++;
    onProgress?.({
      done,
      total: jobs.length,
      failed,
      statusMessage: `Downloaded ${done}/${jobs.length} pages${
        failed > 0 ? ` · ${failed} failed` : ""
      }...`,
    });
  });

  if (done - failed === 0) {
    throw new Error("Every page failed to download — nothing to zip");
  }

  // ── 4. Zip in-browser with fflate ───────────────────────────────────
  // fflate's zipSync is synchronous and runs in ~milliseconds for a few
  // hundred images at store-only level. For very large manga (1000+
  // pages) this could block the main thread — if that becomes an issue
  // we can switch to zip (async) with a worker, but for typical manga
  // sizes sync is fine and keeps the code simple.
  onProgress?.({
    done: jobs.length,
    total: jobs.length,
    failed,
    statusMessage: "Packaging archive...",
  });

  const zipped = zipSync(entries, { level: 0 });

  // ── 5. Trigger the .cbz download ────────────────────────────────────
  const filename = `${sanitizeMangaName(data.mangaName)}.cbz`;
  const blob = new Blob([zipped], {
    type: "application/vnd.comicbook+zip",
  });
  const blobUrl = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  // Revoke on a delay so the download has time to start in the
  // browser — revoking immediately can cancel the in-flight download
  // on some browsers.
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);

  onProgress?.({
    done: jobs.length,
    total: jobs.length,
    failed,
    statusMessage: "Archive ready",
  });

  return {
    filename,
    bytes: zipped.byteLength,
    totalPages: jobs.length,
    failedPages: failed,
  };
}
