// app/backend/downloadLogicForManualAndWeebcentral/download.ts
//
// UPDATED: added `buildMangaCbzBuffer` (and a progress callback) so the
// Trigger.dev task can produce a Buffer to upload to Supabase Storage
// instead of streaming back over HTTP. The original `buildMangaCbzStream`
// is preserved unchanged for backwards compatibility.
import { Readable, Writable, type Transform } from "node:stream";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

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

const { ZipArchive } = require("archiver") as {
  ZipArchive: ZipArchiveConstructor;
};

let nextAllowedRequestTime = 0;

async function rateLimit(delayMs = 250) {
  const now = Date.now();

  if (now < nextAllowedRequestTime) {
    await new Promise((r) => setTimeout(r, nextAllowedRequestTime - now));
  }

  nextAllowedRequestTime = Date.now() + delayMs;
}

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

/** Mirrors the retry loop in download_image() from src/downloader.py */
async function fetchImageBuffer(
  url: string,
  maxRetries = 8,
  backoffFactorMs = 1000
): Promise<Buffer> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await rateLimit(250);

      const response = await fetch(url);

      if (response.status === 429) {
        const retryAfter =
          Number(response.headers.get("retry-after")) || attempt * 5;

        console.log(`429 received. Waiting ${retryAfter}s before retrying...`);

        await new Promise((r) => setTimeout(r, retryAfter * 1000));

        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return Buffer.from(await response.arrayBuffer());
    } catch (err) {
      lastError = err;

      if (attempt < maxRetries) {
        const delay = backoffFactorMs * Math.pow(2, attempt - 1);

        console.log(`Retry ${attempt}/${maxRetries} after ${delay}ms`);

        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw new Error(
    `Failed to download ${url} after ${maxRetries} attempts: ${String(lastError)}`
  );
}

/** Bounded-concurrency map — mirrors asyncio.Semaphore(max_workers) in downloader.py */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  return results;
}

/**
 * Builds a .cbz stream that mirrors create_cbz_for_all() in src/cbz.py.
 * (Unchanged from the original — kept for backwards compatibility.)
 */
export function buildMangaCbzStream(
  options: BuildMangaCbzOptions
): ReadableStream {
  const { chapters, maxWorkers = 10 } = options;
  const archive = new ZipArchive({ zlib: { level: 9 } });

  archive.on("error", (err: Error) => {
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

  (async () => {
    try {
      await mapWithConcurrency(jobs, maxWorkers, async (job) => {
        const buffer = await fetchImageBuffer(job.url);
        archive.append(buffer, { name: job.arcname });
      });
      await archive.finalize();
    } catch (err) {
      console.error("Failed to build CBZ:", err);
      archive.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return Readable.toWeb(archive) as ReadableStream;
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
    onProgress?: (done: number, total: number) => void;
  }
): Promise<Buffer> {
  const { chapters, maxWorkers = 10, onProgress } = options;
  const archive = new ZipArchive({ zlib: { level: 9 } });

  // Collect the archive's output into a Buffer.
  const chunks: Buffer[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk);
      callback();
    },
  });
  archive.pipe(sink);

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

  let done = 0;
  await mapWithConcurrency(jobs, maxWorkers, async (job) => {
    const buffer = await fetchImageBuffer(job.url);
    archive.append(buffer, { name: job.arcname });
    done++;
    onProgress?.(done, jobs.length);
  });

  await archive.finalize();

  // Wait for the sink to flush everything.
  await new Promise<void>((resolve, reject) => {
    sink.on("finish", resolve);
    sink.on("error", reject);
  });

  return Buffer.concat(chunks);
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
    const match = url.match(/\/(\d{4})-(\d{3})\.png$/i);
    if (!match) {
      console.warn(`Skipping URL that didn't match expected pattern: ${url}`);
      continue;
    }
    const chapterNum = match[1]; // e.g. "0001"
    if (!chapterMap.has(chapterNum)) chapterMap.set(chapterNum, []);
    chapterMap.get(chapterNum)!.push(url);
  }

  return Array.from(chapterMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([chapterNum, imageUrls]) => ({
      label: chapterNum, // keep "0001" as-is so download.ts writes chapter_0001, not chapter_1
      imageUrls,
    }));
}
