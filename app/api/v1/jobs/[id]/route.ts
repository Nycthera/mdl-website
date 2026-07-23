// /api/v1/jobs/[id]/route.ts
//
// Polling endpoint for job status — used for the scrape stage of a
// download (the `download-manga` task). The browser polls this while
// scraping is in progress, then once the run completes it asks
// /api/v1/download/urls for the saved page URLs and does the actual
// image download + zip entirely client-side.
//
// PREVIOUSLY this route also handled the `build-cbz` Trigger task:
// when that run completed, it minted a short-lived signed URL pointing
// at the .cbz archive in Supabase Storage. That path is gone now —
// there is no server-side .cbz build and no Storage upload any more —
// so this route only surfaces Trigger.dev metadata. The `downloadUrl`
// field is kept in the response shape for backwards compatibility but
// is always null.
//
// Returns:
//   {
//     id: runId,
//     status: "pending"|"running"|"completed"|"failed",
//     progress: 0..100,
//     mangaName?: string,
//     mangaId?: string,
//     downloadUrl: null,  // always null now — client builds the .cbz
//     filename?: null,    // always null now
//     error?: string
//   }
import { NextResponse } from "next/server";
import { runs } from "@trigger.dev/sdk";
import { getSessionUserId } from "@/lib/get-session";
import { userTagForRun } from "@/app/src/trigger/download-manga";

export const runtime = "nodejs";
export const maxDuration = 15;

interface RunMetadata {
  kind?: "download-manga" | "build-cbz";
  progress?: number;
  mangaName?: string;
  slug?: string;
  chapterCount?: number;
  stage?: string;
  statusMessage?: string;
}

interface RunOutput {
  mangaId?: string;
  mangaName?: string;
  chapterCount?: number;
}

/** Map Trigger's run.status to the local status string the frontend expects. */
function mapStatus(
  triggerStatus: string,
): "pending" | "running" | "completed" | "failed" {
  switch (triggerStatus) {
    case "COMPLETED":
      return "completed";
    case "FAILED":
    case "CRASHED":
    case "TIMED_OUT":
    case "CANCELED":
      return "failed";
    case "EXECUTING":
    case "RETRYING":
      return "running";
    case "QUEUED":
    case "DELAYED":
    case "WAITING_FOR_DEPLOY":
    default:
      return "pending";
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: runId } = await params;

  // ── Auth ───────────────────────────────────────────────────────────
  // Checked against the NextAuth session, not a Supabase cookie session —
  // see lib/get-session.ts for why (GitHub sign-ins never get one).
  const userId = await getSessionUserId();

  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ── Pull the run from Trigger ──────────────────────────────────────
  let run: Awaited<ReturnType<typeof runs.retrieve>>;
  try {
    run = await runs.retrieve(runId);
  } catch {
    return NextResponse.json(
      { error: "run not found", status: "failed" },
      { status: 404 },
    );
  }

  // ── Ownership check ──────────────────────────────────────────────
  // A run id is just an opaque string handed back from POST
  // /api/v1/download — nothing about it proves the caller is the user
  // who enqueued it. Without this check, any signed-in user who
  // obtained (guessed, was shared, scraped from logs) another user's
  // runId could poll it and read their in-progress manga name,
  // progress, and final output. enqueueDownload() tags every run with
  // `user:<userId>` specifically so we can verify that here. Return
  // 404 rather than 403 so we don't confirm/deny the run's existence
  // to someone who doesn't own it.
  const runTags = (run.tags ?? []) as string[];
  if (!runTags.includes(userTagForRun(userId))) {
    return NextResponse.json(
      { error: "run not found", status: "failed" },
      { status: 404 },
    );
  }

  const status = mapStatus(run.status);
  const meta = (run.metadata ?? {}) as RunMetadata;
  const output = (run.output ?? {}) as RunOutput;

  const progress = typeof meta.progress === "number" ? meta.progress : 0;
  const mangaName = meta.mangaName ?? output.mangaName ?? null;
  const mangaId = output.mangaId ?? null;

  // ── Surface an error message if the run failed ─────────────────────
  let error: string | null = null;
  if (status === "failed") {
    const anyRun = run as unknown as {
      error?: { message?: string } | string | null;
    };
    if (typeof anyRun.error === "string") {
      error = anyRun.error;
    } else if (anyRun.error?.message) {
      error = anyRun.error.message;
    } else {
      error = "download failed";
    }
  }

  return NextResponse.json({
    id: runId,
    status,
    progress,
    mangaName,
    mangaId,
    chapterCount: meta.chapterCount ?? output.chapterCount ?? null,
    // Always null now — the client fetches page URLs from
    // /api/v1/download/urls and builds the .cbz itself. Kept in the
    // response shape so the frontend's TypeScript interface stays
    // backwards-compatible with the old build-cbz flow.
    downloadUrl: null,
    filename: null,
    stage: meta.stage ?? null,
    statusMessage: meta.statusMessage ?? null,
    error,
  });
}
