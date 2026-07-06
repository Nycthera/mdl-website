// app/backend/downloadLogicForManualAndWeebcentral/download.ts
//
// CBZ builder + image fetcher.  Used by the streaming route
// /api/v1/download/stream which pipes the archive straight to the
// browser — the Trigger.dev task itself does NOT call into this file
// (it only writes metadata to the DB).  `buildMangaCbzBuffer` is kept
// for backwards compatibility / tests; the streaming route uses
// `buildMangaCbzStream` because it can pipe straight into a Response.
import { Readable, Writable, type Transform } from "node:stream";
import { AsyncLocalStorage } from "node:async_hooks";
import { logger } from "@trigger.dev/sdk";

let _ZipArchive: ZipArchiveConstructor | null = null;
async function getZipArchive(): Promise<ZipArchiveConstructor> {
  if (!_ZipArchive) {
    const mod = await import("archiver");
    _ZipArchive = (mod as unknown as { ZipArchive: ZipArchiveConstructor })
      .ZipArchive;
  }
  return _ZipArchive;
}
import path from "node:path";

import { MIRROR_REQUEST_HEADERS } from "@/app/backend/manual/scrapping/mirrorProbe";

/* ---------------------------------------------------------------------- */
/* archiver v8 typing                                                     */
/* archiver 8.0.0 rewrote its API: it no longer exports a callable        */
/* `archiver('zip', opts)` factory. It now exports format-specific        */
/* classes (`ZipArchive`, `TarArchive`) constructed with `new`.           */
/* @types/archiver hasn't caught up to this yet (still describes the old  */
/* factory-function API — see archiverjs/node-archiver#838), so we        */
/* declare just the slice of the new API we use instead of trusting       */
/* the stale published types.                                            */
/* ---------------------------------------------------------------------- */
interface ZipArchiveOptions {
  zlib?: { level?: number };
  store?: boolean;
  [key: string]: unknown;
}

interface ZipArchiveEntryData {
  name: string;
  date?: Date | string;
  mode?: number;
  prefix?: string;
}

interface ZipArchive extends Transform {
  append(source: Readable | Buffer | string, data: ZipArchiveEntryData): this;
  finalize(): Promise<void>;
  destroy(error?: Error): this;
  pointer(): number;
}

interface ZipArchiveConstructor {
  new (options?: ZipArchiveOptions): ZipArchive;
}

// ---------------------------------------------------------------------- //
// Per-host pacing.
//
// PREVIOUSLY this was a single global ticket shared by every in-flight
// request, regardless of `maxWorkers`. That meant raising concurrency did
// nothing for throughput — every fetch (even to totally unrelated hosts)
// queued behind the same 250ms gate, capping the whole download at ~4
// images/sec no matter how many workers were configured.
//
// Now pacing is tracked per-hostname, so:
//   - Official API hosts we must be polite to (mangadex's image server)
//     still get a sane per-host delay.
//   - Scan-mirror CDNs (lastation/lowee/planeptune etc.) get little-to-no
//     artificial delay — they're just static file hosts — so `maxWorkers`
//     concurrency actually translates into concurrent network throughput.
// ---------------------------------------------------------------------- //
const nextAllowedRequestTimeByHost = new Map<string, number>();

/** Hosts that need a meaningful minimum gap between requests. Everything
 *  else defaults to a near-zero gap (just enough to avoid a thundering herd). */
const HOST_DELAYS_MS: Record<string, number> = {
  "uploads.mangadex.org": 200,
};
const DEFAULT_DELAY_MS = 20;

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

async function rateLimit(url: string) {
  // First: honour any global 429 pause that's currently in effect for
  // this host.  Without this, the worker would race ahead and fire while
  // sibling workers are still in their retry-after wait, re-triggering
  // the 429 storm we're trying to escape.
  await waitForPauseIfAny(url);

  const host = hostnameOf(url);
  const delayMs = HOST_DELAYS_MS[host] ?? DEFAULT_DELAY_MS;
  const nextAllowed = nextAllowedRequestTimeByHost.get(host) ?? 0;
  const now = Date.now();

  if (now < nextAllowed) {
    await new Promise((r) => setTimeout(r, nextAllowed - now));
  }

  nextAllowedRequestTimeByHost.set(host, Date.now() + delayMs);
}

// ---------------------------------------------------------------------- //
// Global 429 backoff coordinator.
//
// PROBLEM: when 8 concurrent workers all hit a 429 on uploads.mangadex.org
// simultaneously, each one independently waits 60s and then they ALL fire
// again at the same instant — guaranteeing another 429.  This is exactly
// the loop we saw in the Trigger.dev trace: 8 × "429 received. Waiting
// 60s" → 8 × "429 received. Waiting 60s" → ... forever.
//
// FIX: a single shared "paused until" timestamp per host.  When any
// worker gets a 429, it pushes the host's pause deadline forward.  Every
// worker checks this deadline (inside rateLimit) before firing, so they
// all back off together and then resume one at a time, paced by the
// per-host delay gate above.
// ---------------------------------------------------------------------- //
const pausedUntilByHost = new Map<string, number>();

/** Called when a request to `url` returned 429.  Pushes the host's pause
 *  deadline forward by `retryAfterMs`.  Other workers will see the new
 *  deadline on their next rateLimit() call and wait. */
function notifyRateLimited(url: string, retryAfterMs: number) {
  const host = hostnameOf(url);
  const now = Date.now();
  const current = pausedUntilByHost.get(host) ?? 0;
  // Use Math.max so a stale shorter deadline can't shorten a newer longer
  // one (e.g. if two workers 429 at slightly different times).
  pausedUntilByHost.set(host, Math.max(current, now + retryAfterMs));
  // Also push the per-host pacing gate forward so the first request after
  // the pause doesn't fire instantly alongside a sibling.
  nextAllowedRequestTimeByHost.set(
    host,
    Math.max(nextAllowedRequestTimeByHost.get(host) ?? 0, now + retryAfterMs),
  );
}

/** Checks whether the host is currently paused due to a recent 429, and
 *  if so, sleeps until the pause expires.  Called from inside rateLimit. */
async function waitForPauseIfAny(url: string) {
  const host = hostnameOf(url);
  const pausedUntil = pausedUntilByHost.get(host) ?? 0;
  const now = Date.now();
  if (now < pausedUntil) {
    await new Promise((r) => setTimeout(r, pausedUntil - now));
  }
}

/** Network timeout for a single image request. Without this, a mirror that
 *  hangs (no response, no error — common with these scan sites) leaves the
 *  whole Trigger.dev run stuck "Executing" forever, since nothing ever
 *  rejects the awaited fetch. This is almost certainly why runs were
 *  appearing to never finish. */
const IMAGE_FETCH_TIMEOUT_MS = 20_000;

/* ---------------------------------------------------------------------- */
/* Input shape — mirrors urls_to_download: List[Tuple[url, chapter_folder]] */
/* from src/downloader.py / src/scrapers/__init__.py                       */
/* ---------------------------------------------------------------------- */

export interface MangaChapterInput {
  /**
   * Chapter label, e.g. "0001", "0045.2". Used for the folder name unless
   * `folder` is given. Should already be zero-padded to match the source
   * folder layout (chapter_0001, chapter_0045.2, etc.) — `normalizeChapterLabel`
   * below will pad bare numbers as a safety net, but decimals like "45.2"
   * can't be auto-padded reliably, so pass them pre-formatted when possible.
   */
  label: string;
  /** Page image URLs for this chapter, in reading order. */
  imageUrls: string[];
  /** Optional explicit folder name. Defaults to `chapter_${label}` (matches scrapers/__init__.py). */
  folder?: string;
}

export interface BuildMangaCbzOptions {
  /** Manga title — becomes the .cbz filename (sanitized), not a path inside the zip. */
  mangaName: string;
  chapters: MangaChapterInput[];
  /** Max concurrent downloads. Mirrors `max_workers` in download_all_pages() (default 10). */
  maxWorkers?: number;
}

/* ---------------------------------------------------------------------- */
/* Helpers mirroring src/utils.py and src/cbz.py                          */
/* ---------------------------------------------------------------------- */

/** Mirrors sanitize_folder_name() in src/utils.py */
function sanitizeFolderName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalizes a chapter label to match the on-disk convention you showed:
 *   chapter_0001, chapter_0045.2, chapter_0065
 * - Plain integers get zero-padded to 4 digits ("1" -> "0001", "45" -> "0045").
 * - Decimal labels ("45.2") get the integer part padded, decimal kept as-is
 *   ("45.2" -> "0045.2"), matching chapter_0045.2 in your listing.
 * - Anything already 4+ digits, or non-numeric, passes through unchanged.
 */
function normalizeChapterLabel(label: string): string {
  const trimmed = label.trim();

  const decimalMatch = trimmed.match(/^(\d+)(\.\d+)$/);
  if (decimalMatch) {
    const [, intPart, decimalPart] = decimalMatch;
    return `${intPart.padStart(4, "0")}${decimalPart}`;
  }

  const intMatch = trimmed.match(/^(\d+)$/);
  if (intMatch) {
    return intMatch[1].padStart(4, "0");
  }

  // Already formatted (e.g. "0045.2") or non-numeric — leave as-is.
  return trimmed;
}

function filenameFromUrl(url: string): string {
  try {
    const base = path.basename(new URL(url).pathname);
    return base || "page.png";
  } catch {
    return "page.png";
  }
}

/**
 * Which sink to write logs to. Set once, at the top of each entry-point
 * function, via `logModeStorage.run(...)` — everything called underneath
 * (fetchImageBuffer, mapWithConcurrency, archive events) inherits it
 * automatically through AsyncLocalStorage, so we don't have to thread a
 * "mode" parameter through every function signature.
 *
 *  - "console": we're inside `buildMangaCbzStream`, called from the
 *    Next.js streaming route — NOT a Trigger.dev task. `logger.*` is a
 *    documented no-op here, so only console output is useful (visible in
 *    the `next dev` terminal).
 *  - "trigger": we're inside `buildMangaCbzBuffer`, called from the
 *    `build-cbz` Trigger.dev task. Trigger.dev captures raw stdout
 *    AND `logger.*` calls independently, so calling both here just
 *    duplicates every line — one clean structured row from `logger`,
 *    plus one ugly plain-text `util.inspect` dump from `console.log`.
 *    We only want the structured one, so console is skipped entirely.
 */
const logModeStorage = new AsyncLocalStorage<"console" | "trigger">();

function dlog(
  step: string,
  details?: Record<string, unknown>,
  level: "debug" | "info" | "warn" | "error" = "debug",
) {
  const mode = logModeStorage.getStore() ?? "console";

  if (mode === "trigger") {
    logger[level](step, details ?? {});
    return;
  }

  const ts = new Date().toISOString().split("T")[1];
  const prefix = `[cbz ${ts}] ${step}`;
  const consoleFn =
    level === "error"
      ? console.error
      : level === "warn"
        ? console.warn
        : console.log;

  if (details !== undefined) {
    consoleFn(prefix, details);
  } else {
    consoleFn(prefix);
  }
}

/** Mirrors the retry loop in download_image() from src/downloader.py
 *
 *  FIX: previously called `fetch(url)` with NO headers.  The scan-mirror
 *  CDNs (lastation / lowee / planeptune) reject bare requests with
 *  403/404 — they require a real browser User-Agent + Referer.  This was
 *  the root cause of the original Trigger.dev hang: every single image
 *  failed, retried 4× with exponential backoff, and the task sat
 *  "Executing" for hours until maxDuration killed it.  `checkMirrorUrl`
 *  in mirrorProbe.ts already sends `MIRROR_REQUEST_HEADERS` and works
 *  fine; this function now does the same. */
async function fetchImageBuffer(
  url: string,
  maxRetries = 4,
  backoffFactorMs = 800,
): Promise<Buffer> {
  let lastError: unknown;
  const startedAt = Date.now();
  dlog("fetch:start", { url });

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await rateLimit(url);

      const attemptStartedAt = Date.now();
      const response = await fetch(url, {
        signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
        headers: MIRROR_REQUEST_HEADERS,
      });
      const attemptMs = Date.now() - attemptStartedAt;

      if (response.status === 429) {
        const retryAfter =
          Number(response.headers.get("retry-after")) || attempt * 5;

        dlog("fetch:429", { url, attempt, retryAfterSec: retryAfter }, "warn");

        // Notify all sibling workers that this host is rate-limited so
        // they pause too — without this, 8 workers each independently
        // wait 60s and then fire simultaneously, guaranteeing another
        // 429.  See the comment block above `notifyRateLimited`.
        notifyRateLimited(url, retryAfter * 1000);

        // Wait out the retry-after ourselves too.  (waitForPauseIfAny
        // inside rateLimit on the next loop iteration would catch this,
        // but waiting here keeps the log message honest.)
        await new Promise((r) => setTimeout(r, retryAfter * 1000));

        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      dlog("fetch:ok", {
        url,
        attempt,
        ms: attemptMs,
        bytes: buffer.byteLength,
        totalMs: Date.now() - startedAt,
      });
      return buffer;
    } catch (err) {
      lastError = err;
      dlog(
        "fetch:error",
        {
          url,
          attempt,
          maxRetries,
          error: err instanceof Error ? err.message : String(err),
        },
        "warn",
      );

      if (attempt < maxRetries) {
        const delay = Math.min(
          backoffFactorMs * Math.pow(2, attempt - 1),
          8_000,
        );

        dlog("fetch:retrying", {
          url,
          attempt,
          nextAttempt: attempt + 1,
          delayMs: delay,
        });

        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  dlog(
    "fetch:exhausted",
    {
      url,
      maxRetries,
      totalMs: Date.now() - startedAt,
      lastError:
        lastError instanceof Error ? lastError.message : String(lastError),
    },
    "error",
  );

  throw new Error(
    `Failed to download ${url} after ${maxRetries} attempts: ${String(lastError)}`,
  );
}

/** Bounded-concurrency map — mirrors asyncio.Semaphore(max_workers) in downloader.py */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  dlog("concurrency:start", { totalJobs: items.length, limit }, "info");
  const results: R[] = new Array(items.length);
  let next = 0;
  let completed = 0;
  let failed = 0;
  async function worker(workerId: number) {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i]);
        completed++;
        if (completed % 10 === 0 || completed === items.length) {
          dlog(
            "concurrency:progress",
            {
              completed,
              failed,
              total: items.length,
              workerId,
            },
            "info",
          );
        }
      } catch (err) {
        failed++;
        dlog(
          "concurrency:job-failed",
          {
            jobIndex: i,
            workerId,
            completedSoFar: completed,
            failedSoFar: failed,
            total: items.length,
            error: err instanceof Error ? err.message : String(err),
          },
          "error",
        );
        throw err;
      }
    }
  }
  try {
    await Promise.all(
      Array.from({ length: Math.min(limit, items.length) }, (_, workerId) =>
        worker(workerId),
      ),
    );
  } finally {
    dlog("concurrency:end", { completed, failed, total: items.length }, "info");
  }
  return results;
}

/**
 * Builds a .cbz stream that mirrors create_cbz_for_all() in src/cbz.py.
 * (Unchanged from the original — kept for backwards compatibility.)
 */
export async function buildMangaCbzStream(
  options: BuildMangaCbzOptions,
): Promise<ReadableStream> {
  return logModeStorage.run("console", async () => {
    const { chapters, maxWorkers = 10 } = options;
    // FIX: images (png/jpg/webp) are already compressed — running them
    // through DEFLATE at max level buys ~1-2% extra size at the cost of a
    // real CPU-bound compression pass on every single image. `store: true`
    // skips compression and just packages the bytes, which is what CBZ
    // tools conventionally do since the payload is images, not text.
    const ZipArchive = await getZipArchive();
    const archive = new ZipArchive({ store: true });

    archive.on("error", (err: Error) => {
      dlog("archive:error-event", { error: err.message }, "error");
      console.error("Archive error:", err);
    });

    const jobs = chapters.flatMap((chapter) => {
      const folder =
        chapter.folder ?? `chapter_${normalizeChapterLabel(chapter.label)}`;
      const named = chapter.imageUrls.map((url) => ({
        url,
        filename: filenameFromUrl(url),
      }));
      named.sort((a, b) => a.filename.localeCompare(b.filename)); // mirrors sorted(files)
      return named.map(({ url, filename }) => ({
        url,
        arcname: `${folder}/${filename}`,
      }));
    });

    dlog(
      "stream:build-start",
      {
        chapters: chapters.length,
        totalJobs: jobs.length,
        maxWorkers,
      },
      "info",
    );

    (async () => {
      try {
        await mapWithConcurrency(jobs, maxWorkers, async (job) => {
          const buffer = await fetchImageBuffer(job.url);
          archive.append(buffer, { name: job.arcname });
          dlog("archive:append", {
            arcname: job.arcname,
            bytes: buffer.byteLength,
          });
        });
        dlog("stream:finalizing", { totalJobs: jobs.length }, "info");
        await archive.finalize();
        dlog("stream:finalized", { totalJobs: jobs.length }, "info");
      } catch (err) {
        dlog(
          "stream:build-failed",
          {
            error: err instanceof Error ? err.message : String(err),
          },
          "error",
        );
        console.error("Failed to build CBZ:", err);
        archive.destroy(err instanceof Error ? err : new Error(String(err)));
      }
    })();

    return Readable.toWeb(archive) as ReadableStream;
  });
}

/**
 * Builds a .cbz as an in-memory Buffer. Used by the Trigger.dev task —
 * there's no HTTP client to stream to, so we collect the archive output
 * into a Buffer and upload it to Supabase Storage.
 *
 * Same chapter/folder naming, same concurrency, same retry logic as
 * `buildMangaCbzStream` — only the sink differs.
 *
 * `onProgress` fires after each image is appended, with (done, total)
 * counts. The task forwards this to Trigger metadata so the polling
 * endpoint can read live progress.
 */
export async function buildMangaCbzBuffer(
  options: BuildMangaCbzOptions & {
    onProgress?: (done: number, total: number, currentFile?: string) => void;
    /** Fires once all images are downloaded, right before we package them
     *  into the archive — the one previously-invisible gap between
     *  "100% downloaded" and the function actually returning. */
    onFinalizing?: () => void;
  },
): Promise<Buffer> {
  return logModeStorage.run("trigger", async () => {
    const { chapters, maxWorkers = 10, onProgress, onFinalizing } = options;
    // FIX: images (png/jpg/webp) are already compressed — running them
    // through DEFLATE at max level buys ~1-2% extra size at the cost of a
    // real CPU-bound compression pass on every single image. For a few
    // hundred+ page manga that's minutes of completely invisible work after
    // the download progress bar already says "100%", which looks exactly
    // like a hung job. `store: true` skips compression and just packages
    // the bytes — this is what CBZ tools conventionally do, since the
    // payload is images, not text.
    const ZipArchive = await getZipArchive();
    const archive = new ZipArchive({ store: true });

    // Collect the archive's output into a Buffer.
    const chunks: Buffer[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    });
    archive.pipe(sink);
    archive.on("error", (err: Error) => {
      dlog("buffer:archive-error-event", { error: err.message }, "error");
    });

    const jobs = chapters.flatMap((chapter) => {
      const folder =
        chapter.folder ?? `chapter_${normalizeChapterLabel(chapter.label)}`;
      const named = chapter.imageUrls.map((url) => ({
        url,
        filename: filenameFromUrl(url),
      }));
      named.sort((a, b) => a.filename.localeCompare(b.filename));
      return named.map(({ url, filename }) => ({
        url,
        arcname: `${folder}/${filename}`,
      }));
    });

    dlog(
      "buffer:build-start",
      {
        chapters: chapters.length,
        totalJobs: jobs.length,
        maxWorkers,
      },
      "info",
    );

    let done = 0;
    await mapWithConcurrency(jobs, maxWorkers, async (job) => {
      const buffer = await fetchImageBuffer(job.url);
      archive.append(buffer, { name: job.arcname });
      done++;
      dlog("buffer:append", {
        arcname: job.arcname,
        bytes: buffer.byteLength,
        done,
        total: jobs.length,
      });
      onProgress?.(done, jobs.length, job.arcname);
    });

    dlog("buffer:finalizing", { totalJobs: jobs.length }, "info");
    onFinalizing?.();
    await archive.finalize();
    dlog("buffer:finalized-waiting-sink", { totalJobs: jobs.length }, "info");

    // Wait for the sink to flush everything.
    //
    // FIX: archive.finalize()'s promise resolves once the internal zip
    // module emits "end" — but for small/fast archives that can happen
    // late enough in the same synchronous flush that the piped `sink`
    // Writable ALREADY emitted its own "finish" event before we get here.
    // Node doesn't replay past stream events to listeners attached
    // afterward, so unconditionally doing sink.on("finish", resolve) here
    // could attach after the event already fired — hanging forever. This
    // is exactly what was happening: the run sat "Executing" with no logs
    // after "buffer:finalized-waiting-sink". Check writableFinished first
    // and skip the wait if the sink already flushed.
    if (!sink.writableFinished) {
      await new Promise<void>((resolve, reject) => {
        sink.on("finish", resolve);
        sink.on("error", reject);
      });
    }

    dlog("buffer:sink-flushed", { chunks: chunks.length }, "info");

    return Buffer.concat(chunks);
  });
}

/** Mirrors `f"{safe_base_name}.cbz"` in create_cbz_for_all() */
export function getCbzFilename(mangaName: string): string {
  return `${sanitizeFolderName(mangaName)}.cbz`;
}

/**
 * Groups a flat list of page URLs back into per-chapter buckets, based on
 * the "<chapterNum>-<pageNum>.png" naming convention used by the scan sites
 * (e.g. "0001-001.png" -> chapter 1, page 1).
 *
 * Output is sorted by chapter number and ready to pass straight into
 * `buildMangaCbzStream({ mangaName, chapters })`.
 */
export function groupUrlsByChapter(urls: string[]): MangaChapterInput[] {
  const chapterMap = new Map<string, string[]>();

  for (const url of urls) {
    // FIX: this previously required exactly 4 digits with no decimal,
    // which silently dropped every page of decimal chapters (e.g.
    // "0049.1-001.png") — the literal cause of "No chapters resolved for
    // this manga" for any manga with a .1/.5-style chapter in its run.
    const match = url.match(/\/(\d{4}(?:\.\d+)?)-(\d{3})\.png$/i);
    if (!match) {
      console.warn(`Skipping URL that didn't match expected pattern: ${url}`);
      continue;
    }
    const chapterNum = match[1]; // e.g. "0001" or "0049.1"
    if (!chapterMap.has(chapterNum)) chapterMap.set(chapterNum, []);
    chapterMap.get(chapterNum)!.push(url);
  }

  return Array.from(chapterMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([chapterNum, imageUrls]) => ({
      label: chapterNum, // keep "0001"/"0049.1" as-is so download.ts writes chapter_0001 / chapter_0049.1
      imageUrls,
    }));
}
