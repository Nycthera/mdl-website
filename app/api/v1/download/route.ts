// /api/v1/download/route.ts
//
// REWRITTEN for Trigger.dev + the user's existing Supabase schema.
// No `downloads` table — the Trigger task writes directly into
// `manga`, `chapters`, `pages`, and `download_history`.
//
// This route just:
//   1. authenticates the user
//   2. enqueues the Trigger.dev task
//   3. returns { runId } immediately
//
// The frontend polls /api/v1/jobs/:runId, which calls runs.retrieve()
// to read live status + progress (metadata-only — no storagePath).
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  enqueueDownload,
  type DownloadSource,
} from "@/src/trigger/download-manga";
import { defineTypeOfURL } from "@/app/backend/utils";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  // ── 1. Auth ────────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ── 2. Parse + validate body ───────────────────────────────────────
  let body: { url?: string; source?: DownloadSource };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const url = body.url?.trim();
  if (!url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  // Trust the client's source if given, otherwise infer from the URL.
  let source = body.source;
  if (!source) {
    const inferred = defineTypeOfURL(url);
    if (!inferred) {
      return NextResponse.json(
        { error: "unsupported URL — cannot determine source" },
        { status: 400 }
      );
    }
    source = inferred;
  }

  // ── 3. Enqueue the Trigger task ────────────────────────────────────
  let runId: string;
  try {
    runId = await enqueueDownload({
      userId: user.id,
      url,
      source,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "failed to enqueue download",
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ runId });
}
