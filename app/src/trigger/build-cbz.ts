// app/src/trigger/build-cbz.ts
//
// Stage 2 of the download pipeline — the part that actually touches image
// bytes. Triggered separately from download-manga.ts, by
// POST /api/v1/download/build, once the user asks to turn a scraped
// manga into a downloadable archive.
//
// This task does NOT scrape anything. It QUERIES the `chapters` +
// `pages` rows that download-manga.ts already saved (image URLs only),
// downloads every one of those URLs, zips them into a .cbz using the
// existing buildMangaCbzBuffer() pipeline, and uploads the result to the
// private `cbz` Storage bucket. /api/v1/jobs/[id] mints a short-lived
// signed URL once this run completes.
import { task, metadata } from "@trigger.dev/sdk";

import { createAdminClient } from "@/lib/supabase/server";
import {
  buildMangaCbzBuffer,
  getCbzFilename,
  type MangaChapterInput,
} from "@/app/backend/downloadLogicForManualAndWeebcentral/download";

export interface BuildCbzPayload {
  userId: string;
  mangaId: string;
}

export interface BuildCbzOutput {
  mangaId: string;
  mangaName: string;
  chapterCount: number;
  filename: string;
  storagePath: string;
}

interface ChapterRow {
  id: string;
  chapter_number: string;
  pages: { page_number: number; image_url: string }[] | null;
}

/**
 * Reads back everything download-manga.ts saved: the manga's title and
 * every chapter's ordered list of page image URLs. This is the "query
 * them to download instead of downloading immediately" step — the image
 * URLs already live in Postgres, so building an archive is just a read +
 * fetch, independent of whatever scrape produced them.
 */
async function loadMangaForBuild(
  supabase: ReturnType<typeof createAdminClient>,
  mangaId: string,
): Promise<{ title: string; chapters: MangaChapterInput[] }> {
  const { data: manga, error: mangaErr } = await supabase
    .from("manga")
    .select("title")
    .eq("id", mangaId)
    .single();

  if (mangaErr || !manga) {
    throw new Error(`manga not found: ${mangaErr?.message ?? mangaId}`);
  }

  const { data: chapterRows, error: chaptersErr } = await supabase
    .from("chapters")
    .select("id, chapter_number, pages(page_number, image_url)")
    .eq("manga_id", mangaId)
    .order("chapter_number", { ascending: true })
    .order("page_number", { ascending: true, referencedTable: "pages" });

  if (chaptersErr) {
    throw new Error(`failed to load chapters: ${chaptersErr.message}`);
  }
  if (!chapterRows || chapterRows.length === 0) {
    throw new Error("no chapters saved for this manga — nothing to build");
  }

  const chapters: MangaChapterInput[] = (chapterRows as ChapterRow[])
    .map((row) => ({
      label: row.chapter_number,
      folder: `chapter_${row.chapter_number}`,
      imageUrls: (row.pages ?? [])
        .sort((a, b) => a.page_number - b.page_number)
        .map((p) => p.image_url),
    }))
    .filter((c) => c.imageUrls.length > 0);

  if (chapters.length === 0) {
    throw new Error("no page URLs saved for this manga — nothing to build");
  }

  return { title: manga.title as string, chapters };
}

export const buildCbz = task({
  id: "build-cbz",
  run: async (payload: BuildCbzPayload, { ctx }): Promise<BuildCbzOutput> => {
    const { userId, mangaId } = payload;
    const supabase = createAdminClient();

    metadata.set("kind", "build-cbz");
    metadata.set("progress", 0);
    metadata.set("stage", "verifying");
    metadata.set("statusMessage", "Verifying ownership...");

    // Re-check ownership independently of the API route's check — the API
    // route can't guarantee this run started immediately after its check.
    const { data: historyRow, error: historyErr } = await supabase
      .from("download_history")
      .select("id")
      .eq("user_id", userId)
      .eq("manga_id", mangaId)
      .limit(1)
      .maybeSingle();

    if (historyErr) {
      throw new Error(`ownership check failed: ${historyErr.message}`);
    }
    if (!historyRow?.id) {
      throw new Error(
        "forbidden — no download_history row for this user/manga",
      );
    }

    metadata.set("stage", "loading");
    metadata.set("statusMessage", "Loading saved page URLs...");

    const { title, chapters } = await loadMangaForBuild(supabase, mangaId);
    metadata.set("mangaName", title);

    const totalPages = chapters.reduce((n, c) => n + c.imageUrls.length, 0);

    metadata.set("stage", "downloading");
    metadata.set("statusMessage", `Downloading 0/${totalPages} pages...`);

    const buffer = await buildMangaCbzBuffer({
      mangaName: title,
      chapters,
      maxWorkers: 8,
      onProgress: (done, total) => {
        metadata.set(
          "progress",
          total > 0 ? Math.round((done / total) * 95) : 0,
        );
        metadata.set("statusMessage", `Downloading ${done}/${total} pages...`);
      },
      onFinalizing: () => {
        metadata.set("stage", "finalizing");
        metadata.set("progress", 96);
        metadata.set("statusMessage", "Packaging archive...");
      },
    });

    const filename = getCbzFilename(title);
    const storagePath = `${userId}/${ctx.run.id}.cbz`;

    metadata.set("stage", "uploading");
    metadata.set("statusMessage", "Uploading archive...");
    metadata.set("progress", 98);

    const { error: uploadErr } = await supabase.storage
      .from("cbz")
      .upload(storagePath, buffer, {
        contentType: "application/vnd.comicbook+zip",
        upsert: true,
      });

    if (uploadErr) {
      throw new Error(`upload failed: ${uploadErr.message}`);
    }

    // Record the finished build against the same download_history row the
    // user's ownership check relies on.
    const { error: updateErr } = await supabase
      .from("download_history")
      .update({
        storage_path: storagePath,
        file_size: buffer.byteLength,
        downloaded_at: new Date().toISOString(),
      })
      .eq("id", historyRow.id);

    if (updateErr) {
      // Non-fatal — the archive is already uploaded and the run's output
      // still carries storagePath, so /api/v1/jobs/[id] can sign it.
      console.error("Failed to update download_history:", updateErr.message);
    }

    metadata.set("stage", "done");
    metadata.set("progress", 100);
    metadata.set("statusMessage", "Archive ready");
    metadata.set("chapterCount", chapters.length);

    return {
      mangaId,
      mangaName: title,
      chapterCount: chapters.length,
      filename,
      storagePath,
    };
  },
});

/** Enqueues a build-cbz run and returns its Trigger.dev run id. */
export async function enqueueCbzBuild(
  payload: BuildCbzPayload,
): Promise<string> {
  const handle = await buildCbz.trigger(payload);
  return handle.id;
}
