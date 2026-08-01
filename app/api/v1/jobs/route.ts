import { NextResponse } from "next/server";
import { runs } from "@trigger.dev/sdk";
import { getSessionUserId } from "@/lib/get-session";
import {
  listDownloadJobs,
  toDownloadJobResponse,
  fromTriggerRunStatus,
  upsertDownloadJob,
} from "@/app/backend/supabaseFunctions/downloadJobs/downloadJobs";
import { userTagForRun } from "@/app/src/trigger/download-manga";

export const runtime = "nodejs";
export const maxDuration = 15;

interface RunMetadata {
  progress?: number;
  mangaName?: string;
  stage?: string;
  statusMessage?: string;
  chapterCount?: number;
}

interface RunOutput {
  mangaId?: string;
  mangaName?: string;
  chapterCount?: number;
}

export async function GET() {
  const userId = await getSessionUserId();

  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const jobs = await listDownloadJobs(userId);
  const activeJobs = jobs.filter(
    (job) => job.status === "queued" || job.status === "running",
  );

  await Promise.all(
    activeJobs.map(async (job) => {
      try {
        const run = await runs.retrieve(job.id);
        const runTags = (run.tags ?? []) as string[];

        if (!runTags.includes(userTagForRun(userId))) {
          return;
        }

        const status = fromTriggerRunStatus(run.status);
        if (!status) return;

        const meta = (run.metadata ?? {}) as RunMetadata;
        const output = (run.output ?? {}) as RunOutput;
        const progress = typeof meta.progress === "number" ? meta.progress : 0;

        await upsertDownloadJob({
          userId,
          runId: job.id,
          status,
          progress,
          mangaId: output.mangaId ?? null,
          mangaName: meta.mangaName ?? output.mangaName ?? null,
          chapterCount: meta.chapterCount ?? output.chapterCount ?? null,
          stage: meta.stage ?? null,
          statusMessage: meta.statusMessage ?? null,
          error: null,
          url: job.url,
          source: job.source,
        });
      } catch {
        // Keep stale rows rather than failing the whole dashboard load.
      }
    }),
  );

  const refreshedJobs = await listDownloadJobs(userId);

  return NextResponse.json({
    jobs: refreshedJobs.map(toDownloadJobResponse),
  });
}
