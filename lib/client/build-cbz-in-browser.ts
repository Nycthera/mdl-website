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
//   3. zips the bytes in-browser with a streaming, store-only ZIP writer
//      (replaces fflate's `zipSync` — see MEMORY SAFETY note below);
//   4. triggers a .cbz download via a Blob URL.
//
// The .cbz layout (chapter_XXXX/<filename>) matches what the old
// server-side buildMangaCbzBuffer produced, so existing readers won't
// notice the difference. The proxy fallback is the only piece of server
// involvement for image bytes — it exists solely because browser fetch
// can't set User-Agent / Referer (forbidden headers) and scan-mirror CDNs
// 403/404 bare requests + don't send Access-Control-Allow-Origin.
//
// ─────────────────────────────────────────────────────────────────────────
// MEMORY SAFETY — why we no longer use fflate's `zipSync`
// ─────────────────────────────────────────────────────────────────────────
// The previous implementation built an `entries` object holding every
// downloaded image as a `Uint8Array`, then called `zipSync(entries)` which
// allocates ONE single `ArrayBuffer` the size of the entire archive.
// For large manga (hundreds of chapters × tens of pages × ~1MB each) that
// single allocation exceeds Chrome's per-`ArrayBuffer` limit (~2GB on
// 64-bit tabs) and throws:
//     RangeError: Array buffer allocation failed
//   at new ArrayBuffer (<anonymous>)
// reported by Sentry on /dashboard.
//
// This file replaces `zipSync` with a hand-rolled streaming ZIP writer
// (`StreamingZipWriter`) that only ever allocates small per-file buffers
// (a 30-byte local header, a 46-byte central-directory header, a 22-byte
// EOCD). The image bytes themselves are passed through by reference. The
// final `new Blob([...chunks])` call is also reference-based — the Blob
// constructor does NOT concatenate its inputs into one buffer.
//
// Net effect:
//   • No single allocation larger than one image.
//   • Peak memory ≈ archive size (1×), not ≈ 3× archive size.
//   • The `RangeError: Array buffer allocation failed` path is gone.
//
// For truly enormous manga (multiple GB) browser tab memory can still be
// exhausted — that's a fundamental limitation of in-browser processing
// without the File System Access API. We mitigate with a page-count guard
// (PAGE_COUNT_HARD_LIMIT) and detailed Sentry reporting if allocation
// still fails.
import * as Sentry from "@sentry/nextjs";

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
 * Hard limit on page count. Above this we refuse to build in-browser
 * because even the streaming writer would likely exhaust tab memory.
 * 10,000 pages × ~800KB ≈ 8GB — well past Chrome's ~4GB tab ceiling.
 *
 * If you need to support larger manga, the right fix is to integrate the
 * File System Access API (showSaveFilePicker + createWritable) so chunks
 * flush to disk instead of accumulating in memory. That requires a user
 * gesture, which the current polling-based download flow doesn't preserve
 * by the time the scrape finishes — see notes in `triggerDownload`.
 */
const PAGE_COUNT_HARD_LIMIT = 10_000;

/**
 * Soft warning threshold. Above this we still build, but we leave a
 * Sentry breadcrumb so any subsequent OOM is contextualised. 2,000 pages
 * × ~800KB ≈ 1.6GB — getting close to the practical limit for low-RAM
 * devices.
 */
const PAGE_COUNT_WARN_THRESHOLD = 2_000;

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

// ─────────────────────────────────────────────────────────────────────────
// CRC-32 (IEEE 802.3 polynomial, same as ZIP / PNG / fflate)
// ─────────────────────────────────────────────────────────────────────────
const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

/** Computes CRC-32 over a Uint8Array. Returns an unsigned 32-bit int. */
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ─────────────────────────────────────────────────────────────────────────
// Streaming, store-only ZIP writer
// ─────────────────────────────────────────────────────────────────────────
// Implements just enough of the ZIP format to produce a valid .cbz:
//   • Local file header (signature 0x04034b50) + file data, per file.
//   • Central directory (signature 0x02014b50), one entry per file.
//   • End-of-central-directory record (signature 0x06054b50).
// Compression method is always 0 (store) — manga images are already
// compressed (JPEG / PNG / WebP), so re-compressing wastes CPU for ~1-2%
// size reduction. This matches what the old server-side buildMangaCbzBuffer
// and fflate's `{ level: 0 }` both did.
//
// All allocations are small and per-file:
//   • 30-byte local header buffer (+ filename bytes, usually <40 bytes).
//   • 46-byte central-directory header buffer (+ filename bytes).
//   • 22-byte EOCD buffer at the very end.
// The image `Uint8Array` is pushed into `chunks` by reference — no copy.
// The final `new Blob([...chunks])` is also reference-based.
//
// This is what eliminates the `RangeError: Array buffer allocation failed`
// that `fflate.zipSync` was triggering on large manga.
class StreamingZipWriter {
  /**
   * Ordered list of chunks that will make up the final Blob.
   *
   * Typed as `BlobPart[]` so the final `new Blob([...this.chunks, ...])`
   * call type-checks. `Uint8Array<ArrayBuffer>` is a valid `BlobPart`;
   * `Uint8Array<ArrayBufferLike>` is NOT (it might be backed by a
   * `SharedArrayBuffer`), which is why every Uint8Array we push here is
   * explicitly constructed from a plain `ArrayBuffer` / `number`.
   */
  private readonly chunks: BlobPart[] = [];
  /** Central-directory entries, built in parallel with local headers. */
  private readonly centralDirectory: Uint8Array<ArrayBuffer>[] = [];
  /** Current write offset (bytes already pushed to `chunks`). */
  private offset = 0;
  /** Number of files added. */
  private fileCount = 0;
  /** Running size of the central directory (for the EOCD record). */
  private centralDirectorySize = 0;

  /**
   * Adds a file to the archive. The `data` Uint8Array is referenced, not
   * copied — do not mutate it after calling this method.
   *
   * The parameter is typed `Uint8Array<ArrayBuffer>` (not the looser
   * `Uint8Array<ArrayBufferLike>`) because `BlobPart` only accepts
   * ArrayBuffer-backed views. Callers obtain such a view trivially via
   * `new Uint8Array(arrayBuffer)`.
   */
  addFile(filename: string, data: Uint8Array<ArrayBuffer>): void {
    const encoder = new TextEncoder();
    const filenameBytes = encoder.encode(filename);
    if (filenameBytes.length > 0xffff) {
      // ZIP fields for filename length are 16-bit. Manga paths are short,
      // so this should never trip — but if it does, fail loudly instead of
      // silently truncating and producing a corrupt archive.
      throw new Error(`Filename too long for ZIP format: ${filename}`);
    }

    const crc = crc32(data);
    const size = data.length;

    // ── Local file header (30 bytes) + filename ──────────────────────
    const localHeader = new Uint8Array(30 + filenameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true); // local file header signature
    lv.setUint16(4, 20, true); // version needed to extract (2.0)
    lv.setUint16(6, 0, true); // general purpose bit flag
    lv.setUint16(8, 0, true); // compression method: 0 = store
    lv.setUint16(10, 0, true); // last mod file time (00:00:00)
    lv.setUint16(12, 0x0021, true); // last mod file date (1980-01-01)
    lv.setUint32(14, crc, true); // CRC-32
    lv.setUint32(18, size, true); // compressed size (== uncompressed for store)
    lv.setUint32(22, size, true); // uncompressed size
    lv.setUint16(26, filenameBytes.length, true); // filename length
    lv.setUint16(28, 0, true); // extra field length
    localHeader.set(filenameBytes, 30);

    const localHeaderSize = 30 + filenameBytes.length;
    const fileOffset = this.offset; // capture before we advance

    this.chunks.push(localHeader);
    this.chunks.push(data); // by reference — no copy
    this.offset += localHeaderSize + size;

    // ── Central directory header (46 bytes) + filename ───────────────
    const cdHeader = new Uint8Array(46 + filenameBytes.length);
    const cv = new DataView(cdHeader.buffer);
    cv.setUint32(0, 0x02014b50, true); // central file header signature
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed to extract
    cv.setUint16(8, 0, true); // general purpose bit flag
    cv.setUint16(10, 0, true); // compression method: 0 = store
    cv.setUint16(12, 0, true); // last mod file time
    cv.setUint16(14, 0x0021, true); // last mod file date
    cv.setUint32(16, crc, true); // CRC-32
    cv.setUint32(20, size, true); // compressed size
    cv.setUint32(24, size, true); // uncompressed size
    cv.setUint16(28, filenameBytes.length, true); // filename length
    cv.setUint16(30, 0, true); // extra field length
    cv.setUint16(32, 0, true); // file comment length
    cv.setUint16(34, 0, true); // disk number start
    cv.setUint16(36, 0, true); // internal file attributes
    cv.setUint32(38, 0, true); // external file attributes
    cv.setUint32(42, fileOffset, true); // relative offset of local header
    cdHeader.set(filenameBytes, 46);

    this.centralDirectory.push(cdHeader);
    this.centralDirectorySize += 46 + filenameBytes.length;
    this.fileCount++;
  }

  /**
   * Finalises the archive and returns a Blob. The Blob references all
   * chunks — no single contiguous allocation is ever made for the full
   * archive, which is what avoids the `RangeError` that `zipSync` hit.
   */
  finish(): Blob {
    const centralDirectoryOffset = this.offset;

    // EOCD record (22 bytes, fixed).
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true); // EOCD signature
    ev.setUint16(4, 0, true); // number of this disk
    ev.setUint16(6, 0, true); // disk where central directory starts
    ev.setUint16(8, this.fileCount, true); // entries on this disk
    ev.setUint16(10, this.fileCount, true); // total entries
    ev.setUint32(12, this.centralDirectorySize, true); // central directory size
    ev.setUint32(16, centralDirectoryOffset, true); // central directory offset
    ev.setUint16(20, 0, true); // comment length

    // `new Blob([...parts])` is reference-based — it does NOT concatenate
    // the parts into a single buffer. This is the other half of why we
    // avoid the OOM: even at Blob construction time, no giant allocation.
    return new Blob([...this.chunks, ...this.centralDirectory, eocd], {
      type: "application/vnd.comicbook+zip",
    });
  }
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
 * Memory model: images are streamed into a `StreamingZipWriter` as they
 * arrive. The writer only ever allocates small per-file header buffers;
 * image bytes are referenced, not copied. The final Blob is also
 * reference-based. See the MEMORY SAFETY comment at the top of this file
 * for why this replaced `fflate.zipSync`.
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
  // Drop a breadcrumb at the very start of the build. If anything
  // below throws (CORS, CDN 403, OOM during zip), the Sentry event
  // will show this breadcrumb — without it, an "AbortError" in the
  // Sentry event tells you nothing about which manga caused it.
  Sentry.addBreadcrumb({
    category: "cbz-build",
    message: `Starting browser-side .cbz build for ${mangaId}`,
    level: "info",
    data: { mangaId },
  });

  // ── 1. Fetch the page URLs from the server ──────────────────────────
  // The server owns the auth + ownership check; we just read the URLs.
  const urlsRes = await fetch(
    `/api/v1/download/urls?mangaId=${encodeURIComponent(mangaId)}`,
  );

  if (!urlsRes.ok) {
    const err = (await urlsRes.json().catch(() => ({}))) as {
      error?: string;
    };
    // Capture the fetch failure with context — the raw error
    // ("Failed to fetch URLs (403)") is useless without knowing
    // which mangaId was requested.
    Sentry.captureException(
      new Error(err.error ?? `Failed to fetch URLs (${urlsRes.status})`),
      {
        tags: { phase: "cbz-urls-fetch" },
        extra: { mangaId, status: urlsRes.status },
      },
    );
    throw new Error(err.error ?? `Failed to fetch URLs (${urlsRes.status})`);
  }

  const data: UrlsResponse = await urlsRes.json();

  if (data.totalPages === 0) {
    throw new Error("No pages to download for this manga");
  }

  // ── 1b. Page-count guard ────────────────────────────────────────────
  // Above the hard limit we refuse outright — even the streaming writer
  // would likely OOM the tab. Between warn and hard limits we proceed
  // but leave a breadcrumb so any failure is contextualised.
  if (data.totalPages > PAGE_COUNT_HARD_LIMIT) {
    const msg =
      `This manga has ${data.totalPages} pages, which exceeds the ` +
      `in-browser build limit of ${PAGE_COUNT_HARD_LIMIT}. ` +
      `Please select fewer chapters or use a smaller download.`;
    Sentry.captureException(new Error(msg), {
      tags: { phase: "cbz-build", outcome: "page-limit-exceeded" },
      extra: {
        mangaId,
        mangaName: data.mangaName,
        totalPages: data.totalPages,
        hardLimit: PAGE_COUNT_HARD_LIMIT,
      },
    });
    throw new Error(msg);
  }

  if (data.totalPages > PAGE_COUNT_WARN_THRESHOLD) {
    Sentry.addBreadcrumb({
      category: "cbz-build",
      message: `Large manga: ${data.totalPages} pages — proceeding but memory pressure likely`,
      level: "warning",
      data: {
        mangaId,
        mangaName: data.mangaName,
        totalPages: data.totalPages,
        warnThreshold: PAGE_COUNT_WARN_THRESHOLD,
      },
    });
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
  //
  // KEY CHANGE vs the old code: instead of accumulating all image bytes
  // into an `entries` object and then calling `zipSync(entries)` at the
  // end (which allocates one giant ArrayBuffer for the whole archive),
  // we stream each image into the `StreamingZipWriter` as it arrives.
  // The writer only ever allocates small per-file header buffers; image
  // bytes are referenced, not copied.
  Sentry.addBreadcrumb({
    category: "cbz-build",
    message: `Downloading ${jobs.length} pages for ${data.mangaName}`,
    level: "info",
    data: {
      mangaId,
      mangaName: data.mangaName,
      totalPages: jobs.length,
      chapterCount: data.chapters.length,
    },
  });

  const zipWriter = new StreamingZipWriter();
  let done = 0;
  let failed = 0;
  // Track which hosts fell back to the proxy during this build —
  // useful context if a Sentry event later reports "all pages failed".
  const proxyHostsSeen = new Set<string>();

  // Wrap the download+zip phase in a try/catch so we can attach rich
  // context (page count, manga name, device memory if available) to any
  // allocation failure that still slips through. This is the exact
  // error Sentry was reporting: `RangeError: Array buffer allocation
  // failed` at `new ArrayBuffer`. With the streaming writer it should
  // no longer happen for typical manga sizes, but if it does (e.g. a
  // single gigantic image, or a device with very low tab memory), we
  // want the Sentry event to explain why.
  try {
    await mapWithConcurrency(jobs, 6, async (job) => {
      try {
        const buf = await fetchImageArrayBuffer(job.url);
        // `StreamingZipWriter.addFile` references `buf` — it does not
        // copy it. We must not mutate `buf` after this point.
        zipWriter.addFile(job.arcname, new Uint8Array(buf));
      } catch (err) {
        failed++;
        // Record which host failed so the breadcrumb at the end of
        // the build shows which CDNs were problematic. The actual
        // per-page error is too noisy to capture individually — a
        // 500-page manga with one bad mirror would generate 500
        // Sentry events.
        const host = hostnameOf(job.url);
        proxyHostsSeen.add(host);
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
  } catch (err) {
    // This catches unexpected errors from the download phase itself
    // (not individual page failures — those are caught above). The most
    // likely residual cause is an allocation failure inside
    // `fetchImageArrayBuffer` if a single image is gigantic, or inside
    // `StreamingZipWriter.addFile` if the central directory grows too
    // large (extremely unlikely — 10k files × 92 bytes ≈ 920KB).
    const deviceMemory =
      typeof navigator !== "undefined" &&
      "deviceMemory" in navigator &&
      typeof navigator.deviceMemory === "number"
        ? (navigator as unknown as { deviceMemory: number }).deviceMemory
        : undefined;
    Sentry.captureException(err, {
      tags: {
        phase: "cbz-build",
        outcome: "download-phase-error",
      },
      extra: {
        mangaId,
        mangaName: data.mangaName,
        totalPages: jobs.length,
        pagesDone: done,
        pagesFailed: failed,
        deviceMemoryGB: deviceMemory,
        failedHosts: Array.from(proxyHostsSeen),
      },
    });
    throw err;
  }

  if (done - failed === 0) {
    // Every single page failed — this is almost always a CORS / CDN
    // outage, not a code bug. Capture with the list of hosts we
    // tried so the Sentry event shows which CDN is down.
    Sentry.captureException(
      new Error("Every page failed to download — nothing to zip"),
      {
        tags: { phase: "cbz-build", outcome: "total-failure" },
        extra: {
          mangaId,
          mangaName: data.mangaName,
          totalPages: jobs.length,
          failedHosts: Array.from(proxyHostsSeen),
        },
      },
    );
    throw new Error("Every page failed to download — nothing to zip");
  }

  // If we had partial failures, leave a breadcrumb so any
  // follow-up error has context. We don't capture this as an error —
  // partial failures are expected on scan-mirror CDNs and the user
  // already gets a toast warning.
  if (failed > 0) {
    Sentry.addBreadcrumb({
      category: "cbz-build",
      message: `Partial download: ${failed}/${jobs.length} pages failed`,
      level: "warning",
      data: {
        mangaId,
        failedHosts: Array.from(proxyHostsSeen),
      },
    });
  }

  // ── 4. Finalise the archive ─────────────────────────────────────────
  // `StreamingZipWriter.finish()` returns a Blob built from an array of
  // small chunks. The Blob constructor is reference-based — it does NOT
  // concatenate the chunks into a single ArrayBuffer. This is the
  // critical difference from the old `zipSync` + `new Blob([zipped])`
  // pattern, which allocated the entire archive as one buffer.
  onProgress?.({
    done: jobs.length,
    total: jobs.length,
    failed,
    statusMessage: "Packaging archive...",
  });

  let blob: Blob;
  try {
    blob = zipWriter.finish();
  } catch (err) {
    // Should be unreachable with the streaming writer, but if it does
    // happen (e.g. filename too long, or some edge case in DataView),
    // capture with full context.
    const deviceMemory =
      typeof navigator !== "undefined" &&
      "deviceMemory" in navigator &&
      typeof navigator.deviceMemory === "number"
        ? (navigator as unknown as { deviceMemory: number }).deviceMemory
        : undefined;
    Sentry.captureException(err, {
      tags: { phase: "cbz-build", outcome: "zip-finalise-error" },
      extra: {
        mangaId,
        mangaName: data.mangaName,
        totalPages: jobs.length,
        pagesFailed: failed,
        deviceMemoryGB: deviceMemory,
      },
    });
    throw err;
  }

  // ── 5. Trigger the .cbz download ────────────────────────────────────
  const filename = `${sanitizeMangaName(data.mangaName)}.cbz`;
  const blobUrl = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  // Revoke on a delay so the download has time to start in the
  // browser — revoking immediately can cancel the in-flight download
  // on some browsers. 60s is generous; for very large archives the
  // browser may still be writing to disk after the click, but the
  // download manager has its own reference by then.
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);

  onProgress?.({
    done: jobs.length,
    total: jobs.length,
    failed,
    statusMessage: "Archive ready",
  });

  Sentry.addBreadcrumb({
    category: "cbz-build",
    message: `Completed .cbz build: ${filename} (${blob.size} bytes)`,
    level: "info",
    data: {
      mangaId,
      filename,
      bytes: blob.size,
      totalPages: jobs.length,
      failedPages: failed,
    },
  });

  return {
    filename,
    bytes: blob.size,
    totalPages: jobs.length,
    failedPages: failed,
  };
}
