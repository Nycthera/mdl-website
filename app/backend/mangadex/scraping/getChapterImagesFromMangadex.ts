// app/backend/mangadex/scraping/getChapterImagesFromMangadex.ts
//
// MangaDex API client: fetches chapter image URLs + chapter ID lists.
//
// Two exports:
//   - getChapterImagesFromMangaDex(chapterId)  → at-home server metadata
//   - getAllChapterIDsForMangaDex(mangaId)     → paginated chapter ID list
//
// Both go through `mangaDexFetch`, which enforces a 220ms pacing gate
// between requests and handles 429 / 5xx retries.

export interface AtHomeResponse {
  baseUrl: string;
  chapter: {
    hash: string;
    data: string[];
    dataSaver: string[];
    [key: string]: any;
  };
}

export interface ChapterImagesResult {
  baseUrl: string;
  hash: string;
  pages: string[];
  fullUrls: string[];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------- //
// Concurrency-safe pacing gate for MangaDex API requests.
//
// PROBLEM (the root cause of the 5-minute 429 storm in the Trigger trace):
// the previous implementation used a single `let lastRequest = 0` variable
// with an `if (elapsed < 220) sleep` check.  This only works for *serial*
// callers.  When multiple workers run concurrently, they all read
// `elapsed` at the same instant, all decide to sleep the same amount, and
// then all fire simultaneously after the sleep — defeating the gate and
// triggering MangaDex's 5 req/s burst limiter, which returns 429 with a
// ~60s retry-after.  That's exactly the batch-of-5 `[429]` log lines,
// 58-60s apart, we saw for 5 minutes straight.
//
// FIX: reserve a fire-slot *synchronously* (no `await` between the read
// and the write of `nextAllowedTime`).  Because JS is single-threaded,
// concurrent callers each reserve a distinct 220ms-spaced slot instead
// of all piling onto the same one.  When any caller gets a 429, it
// pushes `nextAllowedTime` forward so all pending callers also wait.
// ---------------------------------------------------------------------- //
let nextAllowedTime = 0;

/** 220ms between requests ≈ 4.5 req/s, safely under MangaDex's 5 req/s
 *  documented limit. */
const MANGADEX_REQUEST_INTERVAL_MS = 220;

/** Shared headers for every MangaDex API request. MangaDex's docs ask
 *  clients to identify themselves via User-Agent. */
const MANGADEX_HEADERS: Record<string, string> = {
  "User-Agent": "mdl-website/1.0 (manga downloader; +https://mangadex.org)",
  Accept: "application/json",
};

async function mangaDexFetch(url: string, retries = 5): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    // ── Reserve a fire-slot synchronously ────────────────────────────
    // No `await` between the read and the write of nextAllowedTime, so
    // concurrent callers each get a distinct slot.
    const now = Date.now();
    const myFireTime = Math.max(nextAllowedTime, now);
    nextAllowedTime = myFireTime + MANGADEX_REQUEST_INTERVAL_MS;

    const wait = myFireTime - now;
    if (wait > 0) await sleep(wait);

    // ── Fire the request ─────────────────────────────────────────────
    let response: Response;
    try {
      // 15s timeout — without this, a hung request leaves the whole
      // Trigger.dev run "Executing" forever because nothing rejects
      // the awaited fetch.
      response = await fetch(url, {
        signal: AbortSignal.timeout(15_000),
        headers: MANGADEX_HEADERS,
      });
    } catch (err) {
      // Network error / timeout — retry with backoff.
      if (attempt === retries) throw err;
      await sleep(1000 * attempt);
      continue;
    }

    // ── 429: rate limited ────────────────────────────────────────────
    // Push the gate forward so all pending callers also wait, then
    // retry after the cooldown.
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after")) || 15;

      console.log(`[429] MangaDex rate limited. Waiting ${retryAfter}s...`);

      nextAllowedTime = Math.max(
        nextAllowedTime,
        Date.now() + retryAfter * 1000,
      );

      await sleep(retryAfter * 1000);

      continue;
    }

    // ── 5xx: server error — retry with backoff ───────────────────────
    // FIX: the previous code returned on *any* non-429 status, which
    // meant a 503 from MangaDex's API was treated as "success" and then
    // failed with a confusing JSON parse error downstream.  Now we
    // retry 5xx responses like any sane HTTP client.
    if (response.status >= 500) {
      if (attempt === retries) {
        throw new Error(
          `MangaDex returned ${response.status} after ${retries} attempts`,
        );
      }

      console.log(
        `[${response.status}] MangaDex server error. Retrying in ${attempt}s...`,
      );

      await sleep(1000 * attempt);

      continue;
    }

    // ── 2xx, 3xx, 4xx (non-429) — return to caller ───────────────────
    // The caller is responsible for handling 404 etc. via `response.ok`.
    return response;
  }

  throw new Error("Exceeded MangaDex retry limit");
}

export async function getChapterImagesFromMangaDex(
  chapterId: string,
  useSaver = false,
): Promise<ChapterImagesResult> {
  const response = await mangaDexFetch(
    `https://api.mangadex.org/at-home/server/${chapterId}`,
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch chapter images (${response.status})`);
  }

  const data: AtHomeResponse = await response.json();

  const baseUrl = data.baseUrl;
  const hash = data.chapter.hash;

  const pages =
    useSaver && data.chapter.dataSaver.length
      ? data.chapter.dataSaver
      : data.chapter.data;

  const folder = useSaver ? "data-saver" : "data";

  const fullUrls = pages.map((page) => `${baseUrl}/${folder}/${hash}/${page}`);

  return {
    baseUrl,
    hash,
    pages,
    fullUrls,
  };
}

export async function getAllChapterIDsForMangaDex(
  mangaId: string,
  language = "en",
): Promise<string[]> {
  const chapterIds: string[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const res = await mangaDexFetch(
      `https://api.mangadex.org/manga/${mangaId}/feed?limit=${limit}&offset=${offset}&translatedLanguage[]=${language}&order[chapter]=asc`,
    );

    if (!res.ok) {
      throw new Error(`Failed to fetch chapters (${res.status})`);
    }

    const data = await res.json();

    chapterIds.push(...data.data.map((chapter: any) => chapter.id));

    if (offset + limit >= data.total) {
      break;
    }

    offset += limit;
  }

  return chapterIds;
}
