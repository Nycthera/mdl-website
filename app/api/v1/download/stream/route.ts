// /api/v1/download/stream/route.ts
//
// STREAMING DOWNLOAD — no Supabase Storage involved.
//
// After the Trigger.dev task finishes scraping + writing metadata to the
// DB, the dashboard polls /api/v1/jobs/:runId.  When the run is COMPLETED,
// the polling endpoint returns `streamUrl` pointing here with the mangaId.
//
// This route then:
//   1. Authenticates the user (session cookie).
//   2. Verifies ownership (download_history or manga existence fallback).
//   3. Reads all chapter + page URLs from the DB (no re-scraping).
//   4. Pre-flight: fetches the FIRST image to verify the CDN is reachable
//      BEFORE committing to the stream.  If this fails, we can still
//      return a proper JSON error response.
//   5. Builds a .cbz stream on-the-fly and pipes it to the response.
//
// Every step logs to the server console so you can watch the flow in
// `next dev` terminal output.  Without this, a mid-stream failure just
// shows up as a mysterious "Failed - Network error" in the browser with
// no server-side clue about what went wrong.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  buildMangaCbzStream,
  type MangaChapterInput,
} from "@/app/backend/downloadLogicForManualAndWeebcentral/download";
import { MIRROR_REQUEST_HEADERS } from "@/app/backend/manual/scrapping/mirrorProbe";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

interface ChapterRow {
  id: string;
  source_chapter_id: string;
}

interface PageRow {
  chapter_id: string;
  page_number: number;
  image_url: string;
}

/** Sanitise a manga title for use as a download filename. */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Log with a timestamp prefix so the lines are easy to spot in the
 *  `next dev` terminal output. */
function log(step: string, details?: unknown) {
  const ts = new Date().toISOString().split("T")[1];
  if (details !== undefined) {
    console.log(`[stream ${ts}] ${step}`, details);
  } else {
    console.log(`[stream ${ts}] ${step}`);
  }
}

/** Pre-flight check: fetch the first image and verify it returns 2xx.
 *  Returns true on success, false on failure.  We do this BEFORE
 *  committing to the stream so we can still return a proper JSON error
 *  response if the CDN is unreachable. */
async function preflightFirstImage(url: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: MIRROR_REQUEST_HEADERS,
    });
    if (res.ok) {
      return { ok: true, status: res.status };
    }
    return { ok: false, status: res.status, error: `HTTP ${res.status}` };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function GET(req: NextRequest) {
  log("GET /api/v1/download/stream");

  // ── 1. Auth ────────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    log(" unauthorized — no user session");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  log("✓ auth", { userId: user.id });

  // ── 2. Parse + validate mangaId ────────────────────────────────────
  const mangaId = req.nextUrl.searchParams.get("mangaId");
  if (!mangaId) {
    log(" missing mangaId query param");
    return NextResponse.json(
      { error: "mangaId query parameter is required" },
      { status: 400 }
    );
  }
  log("✓ mangaId", { mangaId });

  // ── 3. Ownership check (with fallback) ─────────────────────────────
  let ownershipOk = false;

  try {
    const { data: ownership, error: ownershipErr } = await supabase
      .from("download_history")
      .select("id")
      .eq("user_id", user.id)
      .eq("manga_id", mangaId)
      .limit(1);

    if (!ownershipErr && ownership && ownership.length > 0) {
      ownershipOk = true;
      log("✓ ownership via download_history");
    } else if (ownershipErr) {
      log("⚠ download_history query failed", { error: ownershipErr.message });
    }
  } catch (err) {
    log("⚠ download_history threw", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (!ownershipOk) {
    const { data: mangaExists, error: mangaExistErr } = await supabase
      .from("manga")
      .select("id")
      .eq("id", mangaId)
      .limit(1);

    if (mangaExistErr || !mangaExists || mangaExists.length === 0) {
      log(" manga not found", { error: mangaExistErr?.message });
      return NextResponse.json(
        { error: "forbidden — manga not found or you do not have access" },
        { status: 403 }
      );
    }
    log("✓ ownership via manga existence (fallback)");
  }

  // ── 4. Fetch manga title + source ──────────────────────────────────
  const { data: manga, error: mangaErr } = await supabase
    .from("manga")
    .select("title, source")
    .eq("id", mangaId)
    .single();

  if (mangaErr || !manga) {
    log(" manga lookup failed", { error: mangaErr?.message });
    return NextResponse.json({ error: "manga not found" }, { status: 404 });
  }

  const mangaSource = (manga as { source: string }).source;
  log("✓ manga", { title: manga.title, source: mangaSource });

  // ── 5. Fetch chapters (ordered by chapter_number ascending) ────────
  const { data: chapters, error: chaptersErr } = await supabase
    .from("chapters")
    .select("id, source_chapter_id, chapter_number")
    .eq("manga_id", mangaId)
    .order("chapter_number", { ascending: true });

  if (chaptersErr || !chapters || chapters.length === 0) {
    log(" no chapters", { error: chaptersErr?.message });
    return NextResponse.json(
      { error: "no chapters found for this manga" },
      { status: 404 }
    );
  }
  log("✓ chapters", { count: chapters.length });

  // ── 6. Fetch all pages for those chapters ──────────────────────────
  const chapterIds = (chapters as ChapterRow[]).map((c) => c.id);
  const BATCH_SIZE = 50;
  const allPages: PageRow[] = [];

  for (let i = 0; i < chapterIds.length; i += BATCH_SIZE) {
    const batch = chapterIds.slice(i, i + BATCH_SIZE);
    const { data: batchPages, error: pagesErr } = await supabase
      .from("pages")
      .select("chapter_id, page_number, image_url")
      .in("chapter_id", batch)
      .order("page_number", { ascending: true });

    if (pagesErr) {
      log(" pages fetch failed", { error: pagesErr.message });
      return NextResponse.json(
        { error: `failed to fetch pages: ${pagesErr.message}` },
        { status: 500 }
      );
    }

    if (batchPages) {
      allPages.push(...(batchPages as PageRow[]));
    }
  }

  if (allPages.length === 0) {
    log(" no pages in DB");
    return NextResponse.json(
      { error: "no pages found for this manga" },
      { status: 404 }
    );
  }
  log("✓ pages", { count: allPages.length });

  // ── 7. Group pages by chapter → MangaChapterInput[] ────────────────
  const pagesByChapter = new Map<string, PageRow[]>();
  for (const page of allPages) {
    const arr = pagesByChapter.get(page.chapter_id);
    if (arr) {
      arr.push(page);
    } else {
      pagesByChapter.set(page.chapter_id, [page]);
    }
  }

  const chapterInputs: MangaChapterInput[] = (chapters as ChapterRow[])
    .map((ch) => {
      const pages = pagesByChapter.get(ch.id) ?? [];
      return {
        label: ch.source_chapter_id,
        imageUrls: pages
          .sort((a, b) => a.page_number - b.page_number)
          .map((p) => p.image_url),
      };
    })
    .filter((ch) => ch.imageUrls.length > 0);

  if (chapterInputs.length === 0) {
    log(" no chapters with pages after grouping");
    return NextResponse.json(
      { error: "no chapters with pages found" },
      { status: 404 }
    );
  }

  const totalImages = chapterInputs.reduce(
    (n, c) => n + c.imageUrls.length,
    0
  );
  log("✓ grouped", {
    chapters: chapterInputs.length,
    totalImages,
    firstUrl: chapterInputs[0]?.imageUrls[0]?.slice(0, 80) + "...",
  });

  // ── 8. Pre-flight: fetch the FIRST image before committing to stream ─
  // This is critical.  Once we return a streaming Response, we can't
  // send an error response anymore — the browser would just see a
  // truncated/invalid CBZ and show "Failed - Network error".  By
  // pre-fetching the first image, we can catch CDN issues (403, 404,
  // timeout) and return a proper JSON error instead.
  const firstImageUrl = chapterInputs[0]?.imageUrls[0];
  if (!firstImageUrl) {
    log(" no first image URL");
    return NextResponse.json(
      { error: "no image URL to stream" },
      { status: 500 }
    );
  }

  log("preflight: fetching first image", {
    url: firstImageUrl.slice(0, 100) + "...",
  });
  const preflight = await preflightFirstImage(firstImageUrl);
  if (!preflight.ok) {
    log(" preflight failed — CDN unreachable", {
      status: preflight.status,
      error: preflight.error,
      url: firstImageUrl,
    });
    return NextResponse.json(
      {
        error: `Cannot reach image CDN: ${preflight.error ?? `HTTP ${preflight.status}`}`,
        firstImageUrl,
      },
      { status: 502 }
    );
  }
  log("✓ preflight passed", { status: preflight.status });

  // ── 9. Build the CBZ stream + pipe it to the response ──────────────
  const maxWorkers = mangaSource === "mangadex" ? 3 : 8;
  log("starting stream", { maxWorkers, filename: `${sanitizeFilename(manga.title) || "manga"}.cbz` });

  const cbzStream = buildMangaCbzStream({
    mangaName: manga.title,
    chapters: chapterInputs,
    maxWorkers,
  });

  const filename = `${sanitizeFilename(manga.title) || "manga"}.cbz`;

  // Wrap the stream so we can log when it completes or errors.  The
  // browser receives the raw bytes either way; this just gives us
  // server-side visibility into what happened.
  const loggedStream = new ReadableStream<Uint8Array>({
    start(controller) {
      const reader = (cbzStream as ReadableStream<Uint8Array>).getReader();
      let totalBytes = 0;

      function pump(): Promise<void> {
        return reader
          .read()
          .then(({ done, value }) => {
            if (done) {
              log(`✓ stream complete`, { totalBytes });
              controller.close();
              return;
            }
            if (value) {
              totalBytes += value.byteLength;
              controller.enqueue(value);
            }
            return pump();
          })
          .catch((err) => {
            log(" stream error", {
              error: err instanceof Error ? err.message : String(err),
              totalBytesBeforeError: totalBytes,
            });
            controller.error(err);
          });
      }
      pump();
    },
  });

  return new Response(loggedStream, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.comicbook+zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    },
  });
}