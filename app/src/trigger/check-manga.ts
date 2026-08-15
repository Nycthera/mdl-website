// app/src/trigger/check-manga.ts
//
// Manual "Check now" / "Check all" task. For each linked manga_data row,
// asks MangaDex for the latest chapter number and writes it back onto
// that row (latest_chapter_from_mangadex + date_last_checked).
//
// Deliberately separate from download-manga.ts: this never touches
// `manga` / `chapters` / `pages` / `download_history` — those belong to
// the newer scrape-and-download pipeline. This task only ever reads
// from MangaDex and writes to the legacy manga_data table the dashboard
// reads from.
import { task, metadata } from "@trigger.dev/sdk";
import * as Sentry from "@sentry/nextjs";

import { getLatestMangaDexChapterNumber } from "@/app/backend/mangadex/scraping/getChapterImagesFromMangadex";
import { updateMangaDataCheckResult } from "@/app/backend/supabaseFunctions/getMangaInfo/getMangaInfo";

// Same hardcoded-DSN reasoning as download-manga.ts: this worker process
// never loads Next.js's instrumentation.ts, so Sentry has to be
// initialized here explicitly.
const SENTRY_DSN =
  "https://903376cec7957b7a2486e9937dfb8a90@o4509070019788800.ingest.us.sentry.io/4511717220679680";

Sentry.init({
  dsn: SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
  release: process.env.SENTRY_RELEASE,
  tracesSampleRate:
    (process.env.VERCEL_ENV ?? process.env.NODE_ENV) === "production"
      ? 0.05
      : 0,
  initialScope: {
    tags: { runtime: "trigger-worker" },
  },
});

export interface CheckMangaTarget {
  mangaDataId: number;
  mangaName: string;
  mangadexId: string;
}

export interface CheckMangaPayload {
  userId: string;
  targets: CheckMangaTarget[];
}

export interface CheckMangaResult {
  mangaDataId: number;
  mangaName: string;
  latestChapter: number | null;
  error?: string;
}

export interface CheckMangaOutput {
  results: CheckMangaResult[];
}

export const checkManga = task({
  id: "check-manga",
  run: async (payload: CheckMangaPayload): Promise<CheckMangaOutput> => {
    const { userId, targets } = payload;

    return await Sentry.withScope(async () => {
      Sentry.setUser({ id: userId });
      Sentry.setContext("check", { targetCount: targets.length });

      metadata.set("kind", "check-manga");
      metadata.set("progress", 0);
      metadata.set("statusMessage", `Checking ${targets.length} manga...`);

      const results: CheckMangaResult[] = [];

      for (let i = 0; i < targets.length; i++) {
        const target = targets[i];

        metadata.set(
          "statusMessage",
          `Checking ${target.mangaName} (${i + 1}/${targets.length})...`,
        );

        try {
          const latestChapter = await getLatestMangaDexChapterNumber(
            target.mangadexId,
          );

          if (latestChapter !== null) {
            await updateMangaDataCheckResult(target.mangaDataId, latestChapter);
          }

          results.push({
            mangaDataId: target.mangaDataId,
            mangaName: target.mangaName,
            latestChapter,
          });
        } catch (err) {
          // One manga's failure (e.g. a deleted MangaDex series) shouldn't
          // abort the whole batch — same "skip and continue" approach
          // used elsewhere in the scraping backend.
          Sentry.captureException(err, {
            tags: { stage: "check" },
            extra: {
              mangaDataId: target.mangaDataId,
              mangadexId: target.mangadexId,
            },
          });

          results.push({
            mangaDataId: target.mangaDataId,
            mangaName: target.mangaName,
            latestChapter: null,
            error: err instanceof Error ? err.message : "check failed",
          });
        }

        metadata.set("progress", Math.round(((i + 1) / targets.length) * 100));
      }

      metadata.set("stage", "done");
      metadata.set("statusMessage", "Check complete");

      return { results };
    });
  },
});

/** Same tagging convention as download-manga.ts's userTagForRun — kept
 *  as a separate function (rather than importing that one) so this
 *  task's ownership check isn't coupled to the download task's file. */
export function userTagForCheckRun(userId: string): string {
  return `user:${userId}`;
}

export async function enqueueCheck(
  payload: CheckMangaPayload,
): Promise<string> {
  const handle = await checkManga.trigger(payload, {
    tags: [userTagForCheckRun(payload.userId)],
  });
  return handle.id;
}
