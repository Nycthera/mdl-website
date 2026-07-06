// /api/v1/download/build/route.ts
//
// REPLACES the old /api/v1/download/stream route.
//
// The old route downloaded every page image and built the .cbz *inside
// the HTTP request handler*, relying on `maxDuration = 300` to survive
// long manga. That's exactly the kind of work Vercel functions aren't
// built for — see TOFIX.md. This route now just:
//   1. Authenticates the user.
//   2. Verifies ownership (download_history row for this user + manga).
//   3. Enqueues the `build-cbz` Trigger.dev task and returns its run id.
//
// The frontend polls /api/v1/jobs/:runId same as the initial scrape job.
// When that task completes, the polling endpoint mints a short-lived
// signed URL pointing directly at Supabase Storage — the browser
// downloads from there, not through this server.
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getSessionUserId } from "@/lib/get-session";
import { enqueueCbzBuild } from "@/app/src/trigger/build-cbz";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  // ── 1. Auth ────────────────────────────────────────────────────────
  // Checked against the NextAuth session, not a Supabase cookie session —
  // see lib/get-session.ts for why (GitHub sign-ins never get one).
  const userId = await getSessionUserId();

  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ── 2. Parse + validate body ───────────────────────────────────────
  let body: { mangaId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const mangaId = body.mangaId?.trim();
  if (!mangaId) {
    return NextResponse.json({ error: "mangaId is required" }, { status: 400 });
  }

  // ── 3. Ownership check ─────────────────────────────────────────────
  // Strict: require a download_history row for this exact user/manga.
  // The Trigger task re-checks this independently before doing any work,
  // but checking here too lets us return a clean 403 instead of making
  // the user wait on a job that's just going to fail.
  //
  // Uses the admin client (service role) since there's no guaranteed
  // Supabase cookie session for a NextAuth-authenticated request — RLS
  // is bypassed here deliberately, with the user_id filter below standing
  // in for it.
  const supabase = createAdminClient();
  const { data: ownership, error: ownershipErr } = await supabase
    .from("download_history")
    .select("id")
    .eq("user_id", userId)
    .eq("manga_id", mangaId)
    .limit(1);

  if (ownershipErr) {
    return NextResponse.json(
      { error: `ownership check failed: ${ownershipErr.message}` },
      { status: 500 },
    );
  }
  if (!ownership || ownership.length === 0) {
    return NextResponse.json(
      { error: "forbidden — you have not downloaded this manga" },
      { status: 403 },
    );
  }

  // ── 4. Enqueue the build-cbz task ──────────────────────────────────
  let runId: string;
  try {
    runId = await enqueueCbzBuild({ userId, mangaId });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "failed to enqueue cbz build",
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ runId });
}
