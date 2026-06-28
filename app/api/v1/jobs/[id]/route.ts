// /api/v1/jobs/[id]/route.ts
//
// Polling endpoint for download job status. The frontend hits this every
// ~2.5s after enqueuing a download.
//
// There's no `downloads` table — we read everything from Trigger.dev
// directly via `runs.retrieve(runId)`. The task publishes progress through
// `metadata.set({ progress })` and returns `{ mangaId, mangaName,
// chapterCount }` as its output.
//
// STREAMING MODE: no CBZ is uploaded to Supabase Storage.  Instead,
// when the run is COMPLETED, this endpoint returns a `streamUrl`
// pointing at /api/v1/download/stream?mangaId=... — the frontend
// navigates there and the CBZ is built + streamed to the browser in
// real time.
//
// Returns:
//   {
//     id: runId,
//     status: "pending"|"running"|"completed"|"failed",
//     progress: 0..100,
//     mangaName?: string,
//     mangaId?: string,
//     streamUrl?: string,   // only when completed
//     error?: string
//   }
import { NextResponse } from "next/server";
import { runs } from "@trigger.dev/sdk/v3";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 15;

interface RunMetadata {
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
  triggerStatus: string
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
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: runId } = await params;

  // ── Auth ───────────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ── Pull the run from Trigger ──────────────────────────────────────
  let run: Awaited<ReturnType<typeof runs.retrieve>>;
  try {
    run = await runs.retrieve(runId);
  } catch {
    return NextResponse.json(
      { error: "run not found", status: "failed" },
      { status: 404 }
    );
  }

  const status = mapStatus(run.status);
  const meta = (run.metadata ?? {}) as RunMetadata;
  const output = (run.output ?? {}) as RunOutput;

  const progress = typeof meta.progress === "number" ? meta.progress : 0;
  const mangaName = meta.mangaName ?? output.mangaName ?? null;
  const mangaId = output.mangaId ?? null;

  // ── Build the stream URL when the run is COMPLETED ───────────────
  // The streaming route reads page URLs from the DB (which the Trigger
  // task just wrote) and pipes the CBZ to the browser in real time.
  // No Supabase Storage, no signed URLs — just a direct HTTP stream.
  const streamUrl =
    status === "completed" && mangaId
      ? `/api/v1/download/stream?mangaId=${encodeURIComponent(mangaId)}`
      : null;

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
    streamUrl,
    stage: meta.stage ?? null,
    statusMessage: meta.statusMessage ?? null,
    error,
  });
}
