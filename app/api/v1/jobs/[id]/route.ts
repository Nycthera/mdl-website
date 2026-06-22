// /api/v1/jobs/[id]/route.ts
//
// Polling endpoint for download job status. The frontend hits this every
// ~2.5s after enqueuing a download.
//
// There's no `downloads` table — we read everything from Trigger.dev
// directly via `runs.retrieve(runId)`. The task publishes progress through
// `io.updateMetadata({ progress })` and returns `{ storagePath, mangaId,
// mangaName, chapterCount, fileSize }` as its output, which we use to
// mint a signed Supabase Storage URL when the run is COMPLETED.
//
// Returns:
//   {
//     id: runId,
//     status: "pending"|"running"|"completed"|"failed",
//     progress: 0..100,
//     mangaName?: string,
//     downloadUrl?: string,   // signed Supabase Storage URL, only when completed
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
}

interface RunOutput {
  storagePath?: string;
  mangaId?: string;
  mangaName?: string;
  chapterCount?: number;
  fileSize?: number;
}

/** Map Trigger's run.status to the local status string the frontend expects. */
function mapStatus(triggerStatus: string): "pending" | "running" | "completed" | "failed" {
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

  // ── Mint a signed download URL when the run is COMPLETED ───────────
  let downloadUrl: string | null = null;
  if (status === "completed" && output.storagePath) {
    // Auth check: confirm the user actually owns this file. The path is
    // `<userId>/<runId>.cbz`, so the prefix must match their auth.uid().
    const expectedPrefix = `${user.id}/`;
    if (!output.storagePath.startsWith(expectedPrefix)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const { data, error: signErr } = await supabase.storage
      .from("cbz")
      .createSignedUrl(output.storagePath, 3600); // 1 hour

    if (signErr || !data?.signedUrl) {
      return NextResponse.json(
        { error: "failed to mint download URL" },
        { status: 500 }
      );
    }
    downloadUrl = data.signedUrl;
  }

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
    chapterCount: meta.chapterCount ?? output.chapterCount ?? null,
    fileSize: output.fileSize ?? null,
    downloadUrl,
    error,
  });
}
