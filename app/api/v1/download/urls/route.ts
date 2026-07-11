// /api/v1/download/urls/route.ts
//
// REPLACES the old /api/v1/download/build route + build-cbz Trigger task.
//
// The browser no longer asks the server to build a .cbz and upload it to
// Supabase Storage. Instead, the browser:
//   1. calls this endpoint to fetch the list of page image URLs we already
//      saved during the scrape (in the `manga` / `chapters` / `pages`
//      tables — the download-manga task writes them, no image bytes are
//      ever stored server-side);
//   2. fetches each image URL directly from the source CDN;
//   3. zips the bytes in-browser with `fflate` and triggers a .cbz
//      download.
//
// This route is therefore just a thin authenticated read over the
// catalog tables — the heavy lifting (download + zip) is on the client.
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getSessionUserId } from "@/lib/get-session";

export const runtime = "nodejs";
export const maxDuration = 15;

interface ChapterRow {
  id: string;
  chapter_number: string;
  pages: { page_number: number; image_url: string }[] | null;
}

export async function GET(req: NextRequest) {
  // ── 1. Auth ────────────────────────────────────────────────────────
  // Checked against the NextAuth session, not a Supabase cookie session —
  // see lib/get-session.ts for why (GitHub sign-ins never get one).
  const userId = await getSessionUserId();

  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ── 2. Parse + validate query ──────────────────────────────────────
  const mangaId = req.nextUrl.searchParams.get("mangaId")?.trim();

  if (!mangaId) {
    return NextResponse.json(
      { error: "mangaId query parameter is required" },
      { status: 400 },
    );
  }

  // ── 3. Ownership check ─────────────────────────────────────────────
  // Strict: require a download_history row for this exact user/manga,
  // same rule /api/v1/download/build enforced. Without this, any signed-in
  // user could read the page URLs of any manga in the catalog.
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

  // ── 4. Load manga title + chapters + pages ─────────────────────────
  const { data: manga, error: mangaErr } = await supabase
    .from("manga")
    .select("title")
    .eq("id", mangaId)
    .single();

  if (mangaErr || !manga) {
    return NextResponse.json(
      { error: `manga not found: ${mangaErr?.message ?? mangaId}` },
      { status: 404 },
    );
  }

  const { data: chapterRows, error: chaptersErr } = await supabase
    .from("chapters")
    .select("id, chapter_number, pages(page_number, image_url)")
    .eq("manga_id", mangaId)
    .order("chapter_number", { ascending: true })
    .order("page_number", { ascending: true, referencedTable: "pages" });

  if (chaptersErr) {
    return NextResponse.json(
      { error: `failed to load chapters: ${chaptersErr.message}` },
      { status: 500 },
    );
  }

  if (!chapterRows || chapterRows.length === 0) {
    return NextResponse.json(
      { error: "no chapters saved for this manga — nothing to download" },
      { status: 404 },
    );
  }

  // ── 5. Shape the response ──────────────────────────────────────────
  // The browser zips each page into "<folder>/<filename>" inside the .cbz,
  // matching the layout the server-side buildMangaCbzBuffer used to
  // produce. `folder` is `chapter_<chapter_number>` and `filename` is
  // derived from the image URL's basename — same conventions as
  // download.ts so existing readers won't notice the difference.
  const chapters = (chapterRows as ChapterRow[])
    .map((row) => ({
      label: row.chapter_number,
      folder: `chapter_${row.chapter_number}`,
      imageUrls: (row.pages ?? [])
        .sort((a, b) => a.page_number - b.page_number)
        .map((p) => p.image_url),
    }))
    .filter((c) => c.imageUrls.length > 0);

  if (chapters.length === 0) {
    return NextResponse.json(
      { error: "no page URLs saved for this manga — nothing to download" },
      { status: 404 },
    );
  }

  const totalPages = chapters.reduce((n, c) => n + c.imageUrls.length, 0);

  return NextResponse.json({
    mangaId,
    mangaName: manga.title as string,
    chapterCount: chapters.length,
    totalPages,
    chapters,
  });
}
