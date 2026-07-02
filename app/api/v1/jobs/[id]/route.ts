// /api/v1/jobs/[id]/route.ts
//
// Polling endpoint for job status — used for BOTH stages of a download:
//   1. The initial `download-manga` task (scrapes + writes catalog rows).
//   2. The `build-cbz` task (downloads pages, builds the archive, uploads
//      it to Supabase Storage). Triggered separately once the user asks
//      to actually download the manga it just scraped.
//
// There's no `downloads` table — we read everything from Trigger.dev
// directly via `runs.retrieve(runId)`. Both tasks publish progress through
// `metadata.set(...)`; `build-cbz` additionally sets `metadata.kind =
// "build-cbz"` so this route knows which output shape to expect.
//
// When a `build-cbz` run completes, its output includes `storagePath`
// (e.g. "<userId>/<runId>.cbz"). This route mints a short-lived signed
// URL from the private `cbz` bucket and returns it as `downloadUrl` — the
// frontend navigates the browser there directly. We never proxy the
// archive bytes through this server.
//
// Returns:
//   {
//     id: runId,
//     status: "pending"|"running"|"completed"|"failed",
//     progress: 0..100,
//     mangaName?: string,
//     mangaId?: string,
//     downloadUrl?: string,  // only when a build-cbz run completes
//     filename?: string,     // only when a build-cbz run completes
//     error?: string
//   }
import { NextResponse } from "next/server";
import { runs } from "@trigger.dev/sdk";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 15;

// Signed URL lifetime — long enough for a slow connection to start the
// download after the dashboard navigates to it, short enough that a leaked
// link doesn't stay valid indefinitely.
const SIGNED_URL_EXPIRY_SECONDS = 60 * 10; // 10 minutes

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
  /** build-cbz only */
  filename?: string;
  storagePath?: string;
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

  // ── Mint a signed URL when a build-cbz run is COMPLETED ────────────
  // Only build-cbz runs carry a storagePath; the initial download-manga
  // (scrape) run never produces a downloadable archive on its own.
  let downloadUrl: string | null = null;
  let filename: string | null = null;

  if (
    status === "completed" &&
    meta.kind === "build-cbz" &&
    output.storagePath
  ) {
    // Defense-in-depth: storagePath is namespaced "<userId>/<runId>.cbz",
    // so a signed URL can only ever be minted for the bucket prefix the
    // task itself wrote — but double-check it matches this user anyway
    // before signing, in case a stale/forged run id is polled.
    if (output.storagePath.startsWith(`${user.id}/`)) {
      const { data: signed, error: signErr } = await supabase.storage
        .from("cbz")
        .createSignedUrl(output.storagePath, SIGNED_URL_EXPIRY_SECONDS, {
          download: output.filename ?? true,
        });

      if (!signErr && signed?.signedUrl) {
        downloadUrl = signed.signedUrl;
        filename = output.filename ?? null;
      }
    }
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
    mangaId,
    chapterCount: meta.chapterCount ?? output.chapterCount ?? null,
    downloadUrl,
    filename,
    stage: meta.stage ?? null,
    statusMessage: meta.statusMessage ?? null,
    error,
  });
}
