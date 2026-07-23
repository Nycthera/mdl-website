// app/src/trigger/download-manga.ts
//
// Stage 1 of the download pipeline.
//
// This task NEVER fetches image bytes — it only resolves each chapter's
// list of page image URLs from the source (MangaDex API / WeebCentral
// HTML / scan-mirror guess-and-check) and writes them into
// `manga` / `chapters` / `pages` via persistScrapedManga. The actual
// downloading + zipping happens entirely client-side: the browser asks
// GET /api/v1/download/urls for the saved URLs, downloads each image,
// and zips them with fflate into a .cbz. No server-side build step.
import { task, metadata } from "@trigger.dev/sdk";
import * as Sentry from "@sentry/nextjs";

import { getMangaDexInfoFromURL, returnGlobFromURL } from "@/app/backend/utils";
import { makeResultsIntoArrayFormatForDownloadFunction } from "@/app/backend/mangadex/makeResultsIntoArrayFormatForDownloadFunction";
import { getCoverFromMangadex } from "@/app/backend/mangadex/scraping/getCoverFromMangadex";
import { findCoverImageURL } from "@/app/backend/manual/scrapping/getCoverImageURLFromManualURL";
import { gatherAllUrlsFromSample } from "@/app/backend/manual/scrapping/getAllImagesFromManual";
import { groupUrlsByChapter } from "@/app/backend/downloadLogicForManualAndWeebcentral/download";
import {
  isWeebCentralSeriesUrl,
  discoverSeriesUrlFromChapterPage,
  getWeebCentralSeriesChapters,
  getWeebCentralSeriesTitle,
  weebCentralSeriesSlug,
  slugToTitle,
} from "@/app/backend/weebcentral/scrapping/getSeriesChapterList";
import {
  fetchChapterImageUrls,
  fetchManualImages,
} from "@/app/backend/weebcentral/scrapping/getImageURLFromInputURL";
import {
  persistScrapedManga,
  type ScrapedChapter,
} from "@/app/backend/supabaseFunctions/mangaMetadata/persistManga";

/**
 * Sentry DSN — hardcoded rather than read from `process.env` because
 * the Trigger.dev worker does NOT inherit Next.js's `.env.local` (it
 * runs as a separate process via `pnpm exec trigger dev`). Reading
 * from env would silently produce `undefined` and Sentry.init would
 * no-op without raising. This matches what's already committed in
 * sentry.server.config.ts.
 *
 * The org + project come from next.config.ts's withSentryConfig.
 */
const SENTRY_DSN =
  "https://903376cec7957b7a2486e9937dfb8a90@o4509070019788800.ingest.us.sentry.io/4511717220679680";

/**
 * Idempotently initialize Sentry inside the Trigger.dev worker.
 *
 * This is necessary because the worker is a separate Node.js process
 * (started by `pnpm exec trigger dev` locally, or by Trigger.dev's
 * hosted runtime in prod). Next.js's `instrumentation.ts` — which
 * imports `sentry.server.config` on the Next.js side — is NEVER
 * loaded in this process. Without this init, errors thrown from the
 * task body would go to Trigger.dev's dashboard but NOT to Sentry.
 *
 * `Sentry.init` is safe to call multiple times — subsequent calls
 * are no-ops if the DSN matches — so we call it at module load.
 */
Sentry.init({
  dsn: SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
  release: process.env.SENTRY_RELEASE,
  // Lower sample rate in the worker — Trigger.dev already gives us
  // trace-level visibility into task execution, so Sentry traces here
  // are redundant. Errors are still 100% captured (no sample rate on
  // errors).
  tracesSampleRate:
    (process.env.VERCEL_ENV ?? process.env.NODE_ENV) === "production"
      ? 0.05
      : 0,
  // Tag every event from the worker so we can filter them in the
  // Sentry UI: `runtime:trigger-worker` separates these from
  // `runtime:nextjs-server` events.
  initialScope: {
    tags: { runtime: "trigger-worker" },
  },
});

export type DownloadSource = "mangadex" | "weebcentral" | "manual";

export interface DownloadMangaPayload {
  userId: string;
  url: string;
  source: DownloadSource;
}

export interface DownloadMangaOutput {
  mangaId: string;
  mangaName: string;
  chapterCount: number;
}

/** `/series/<id>/<slug>` -> `<id>`. Falls back to the whole path if the
 *  URL doesn't match the expected shape (still stable/unique per series). */
function weebCentralSeriesId(seriesUrl: string): string {
  try {
    const parts = new URL(seriesUrl).pathname.split("/").filter(Boolean);
    return parts[1] ?? seriesUrl;
  } catch {
    return seriesUrl;
  }
}

/** `/chapters/<id>` -> `chapter:<id>`. Used ONLY as a last-resort
 *  sourceMangaId when we have a chapter URL but couldn't discover its
 *  parent series (see the fallback branch in resolveWeebCentral below).
 *  Namespaced with a `chapter:` prefix so it can NEVER collide with a
 *  real weebCentralSeriesId() value — those are bare IDs with no prefix.
 *  Previously this fallback used the scraped page title instead, which
 *  varied across scrapes and produced duplicate `manga` rows for series
 *  that already existed under their real ID (title text isn't a stable
 *  identifier). Deriving from the URL itself is deterministic and, if the
 *  same chapter URL is retried, dedupes against itself instead of
 *  spawning a new row every time. */
function weebCentralChapterFallbackId(chapterUrl: string): string {
  try {
    const parts = new URL(chapterUrl).pathname.split("/").filter(Boolean);
    return `chapter:${parts[1] ?? chapterUrl}`;
  } catch {
    return `chapter:${chapterUrl}`;
  }
}

async function resolveMangaDex(url: string) {
  const { id, name } = getMangaDexInfoFromURL(url);

  metadata.set("mangaName", name);
  metadata.set("stage", "resolving-chapters");
  metadata.set("statusMessage", "Fetching chapter list from MangaDex...");

  const coverUrl = await getCoverFromMangadex(id).catch(() => null);

  const chapters: ScrapedChapter[] =
    await makeResultsIntoArrayFormatForDownloadFunction(url, (done, total) => {
      metadata.set(
        "progress",
        total > 0 ? Math.round((done / total) * 100) : 0,
      );
      metadata.set("statusMessage", `Resolved ${done}/${total} chapters...`);
    });

  return {
    sourceMangaId: id,
    title: name,
    coverUrl,
    chapters,
  };
}

async function resolveWeebCentral(url: string) {
  const seriesUrl = isWeebCentralSeriesUrl(url)
    ? url
    : await discoverSeriesUrlFromChapterPage(url);

  // No series link discoverable — fall back to single-chapter behavior
  // rather than failing the whole run.
  if (!seriesUrl) {
    metadata.set("statusMessage", "Resolving single chapter...");
    const { imageUrls, title } = await fetchManualImages(url);
    if (imageUrls.length === 0) {
      throw new Error("Could not resolve any pages for this WeebCentral URL");
    }
    // IMPORTANT: sourceMangaId must be derived from the URL, never from a
    // scraped title. Series discovery failed, so we don't know the real
    // series ID here — but reusing `title` as the identifier is what
    // caused duplicate `manga` rows in prod: the same series later
    // resolved normally (via weebCentralSeriesId) got a different,
    // "real" sourceMangaId, so upsertMangaRow's lookup missed and
    // inserted a second row instead of updating the first. Namespacing
    // with `chapter:` guarantees this never collides with a real series
    // ID, and deriving it from the URL keeps it stable across retries.
    return {
      sourceMangaId: weebCentralChapterFallbackId(url),
      title,
      coverUrl: imageUrls[0] ?? null,
      chapters: [{ label: "0001", imageUrls }] as ScrapedChapter[],
    };
  }

  metadata.set("stage", "resolving-chapters");
  metadata.set("statusMessage", "Fetching chapter list from WeebCentral...");

  const [title, chapterRefs] = await Promise.all([
    getWeebCentralSeriesTitle(seriesUrl),
    getWeebCentralSeriesChapters(seriesUrl),
  ]);

  // Title fallback chain:
  //   1. Real title scraped from the series page (best).
  //   2. URL slug, title-cased (e.g. "Aishiteru-Game-wo-Owarasetai" →
  //      "Aishiteru Game Wo Owarasetai"). Better than the ID because
  //      it's human-readable and matches what the .cbz filename should
  //      look like.
  //   3. Internal WeebCentral ID (worst — last resort when the URL has
  //      no slug, e.g. a bare /series/<id> with no trailing path).
  //
  // PREVIOUSLY this fell straight to (3), so a stale title selector on
  // WeebCentral's end caused the manga to be saved with its ID as the
  // title — and the client-side .cbz builder then named the file
  // "<id>.cbz" because that's what was in the DB. Falling back to the
  // slug first fixes that.
  const slug = weebCentralSeriesSlug(seriesUrl);
  const resolvedTitle =
    title ?? (slug ? slugToTitle(slug) : weebCentralSeriesId(seriesUrl));
  metadata.set("mangaName", resolvedTitle);

  const chapters: ScrapedChapter[] = [];
  let coverUrl: string | null = null;

  for (let i = 0; i < chapterRefs.length; i++) {
    const ref = chapterRefs[i];
    const imageUrls = await fetchChapterImageUrls(ref.url);

    if (imageUrls.length === 0) {
      // Mirrors the existing "skip a bad chapter, don't fail the whole
      // series" behavior used elsewhere in the scraping backend.
      continue;
    }

    if (!coverUrl) coverUrl = imageUrls[0];

    chapters.push({
      label: String(i + 1).padStart(4, "0"),
      imageUrls,
    });

    metadata.set("progress", Math.round(((i + 1) / chapterRefs.length) * 100));
    metadata.set(
      "statusMessage",
      `Resolved ${i + 1}/${chapterRefs.length} chapters...`,
    );
  }

  return {
    sourceMangaId: weebCentralSeriesId(seriesUrl),
    title: resolvedTitle,
    coverUrl,
    chapters,
  };
}

async function resolveManual(url: string) {
  const slug = returnGlobFromURL(url);
  if (!slug) throw new Error("Could not determine manga slug from URL");

  const title = slug
    .split(/[-_]/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");

  metadata.set("mangaName", title);
  metadata.set("stage", "resolving-pages");
  metadata.set("statusMessage", "Probing scan mirrors for pages...");

  const [coverUrl, flatUrls] = await Promise.all([
    findCoverImageURL(url).catch(() => null),
    gatherAllUrlsFromSample(url),
  ]);

  if (flatUrls.length === 0) {
    throw new Error("No chapters resolved for this manga");
  }

  const chapters = groupUrlsByChapter(flatUrls);

  return {
    sourceMangaId: slug,
    title,
    coverUrl,
    chapters: chapters as ScrapedChapter[],
  };
}

export const downloadManga = task({
  id: "download-manga",
  run: async (payload: DownloadMangaPayload): Promise<DownloadMangaOutput> => {
    const { userId, url, source } = payload;

    // Wrap the entire task body in a Sentry scope so every event
    // captured during this run (whether via the explicit
    // captureException below or via unhandled-rejection hooks Sentry
    // installs at init) carries the user id, source, and URL.
    //
    // We do NOT use Sentry.startSpan() here because Trigger.dev
    // already wraps the task in its own span — adding a second one
    // produces nested, confusing traces.
    return await Sentry.withScope(async () => {
      Sentry.setUser({ id: userId });
      Sentry.setTag("source", source);
      Sentry.setContext("download", {
        url,
        source,
        userId,
      });

      metadata.set("kind", "download-manga");
      metadata.set("progress", 0);
      metadata.set("stage", "starting");
      metadata.set("statusMessage", "Starting scrape...");

      Sentry.addBreadcrumb({
        category: "trigger",
        message: `download-manga task started for ${source}`,
        level: "info",
        data: { url, source, userId },
      });

      try {
        const resolved =
          source === "mangadex"
            ? await resolveMangaDex(url)
            : source === "weebcentral"
              ? await resolveWeebCentral(url)
              : await resolveManual(url);

        if (resolved.chapters.length === 0) {
          throw new Error("No chapters could be resolved for this manga");
        }

        // Once we know the title, push it onto the Sentry scope so
        // any error in the persist step below includes it. Without
        // this, a persistManga failure would show only the URL —
        // useless when the URL is a long WeebCentral slug.
        Sentry.setContext("manga", {
          title: resolved.title,
          sourceMangaId: resolved.sourceMangaId,
          chapterCount: resolved.chapters.length,
        });

        metadata.set("stage", "saving");
        metadata.set("statusMessage", "Saving chapter/page index...");
        metadata.set("progress", 95);

        // ── Save URLs ONLY — no image bytes are fetched here. ──────────
        const { mangaId, chapterCount } = await persistScrapedManga(userId, {
          source,
          sourceMangaId: resolved.sourceMangaId,
          title: resolved.title,
          coverUrl: resolved.coverUrl,
          chapters: resolved.chapters,
        });

        metadata.set("progress", 100);
        metadata.set("stage", "done");
        metadata.set("statusMessage", "Scrape complete");
        metadata.set("mangaName", resolved.title);
        metadata.set("chapterCount", chapterCount);

        Sentry.addBreadcrumb({
          category: "trigger",
          message: `download-manga task completed: ${chapterCount} chapters persisted`,
          level: "info",
          data: { mangaId, chapterCount },
        });

        return {
          mangaId,
          mangaName: resolved.title,
          chapterCount,
        };
      } catch (err) {
        // Capture the error to Sentry BEFORE rethrowing. Trigger.dev
        // will record the failure in its own dashboard, but without
        // this capture the Sentry project would never see it — and
        // the Sentry event is what fires the alert email/Slack.
        //
        // We include the stage from metadata so the Sentry event
        // tells you *where* in the pipeline the failure happened,
        // not just *what* threw.
        Sentry.captureException(err, {
          tags: {
            source,
            stage: "scrape",
          },
          extra: {
            url,
            userId,
            stage: "scraping",
          },
        });
        throw err;
      }
    });
  },
});

/** Tag applied to every run so /api/v1/jobs/:id can verify the
 *  requesting session actually owns the run before returning its
 *  status. Without this, runId is just an opaque Trigger.dev id —
 *  anything guessable/leaked (browser history, a shared link, logs)
 *  would let ANY signed-in user poll ANY other user's job and see
 *  their manga name / progress / output. See jobs/[id]/route.ts. */
export function userTagForRun(userId: string): string {
  return `user:${userId}`;
}

/** Enqueues a download-manga run and returns its Trigger.dev run id. */
export async function enqueueDownload(
  payload: DownloadMangaPayload,
): Promise<string> {
  const handle = await downloadManga.trigger(payload, {
    tags: [userTagForRun(payload.userId)],
  });
  return handle.id;
}
