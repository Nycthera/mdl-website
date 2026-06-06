import { NextResponse } from "next/server";
import { createJob, setJobRunning, setJobFinished, setJobFailed } from "../../../backend/jobs";
import { gatherUrls, downloadUrls } from "../../../backend/generic";
import { downloadMdChapters, extractUuidFromUrl } from "../../../backend/mangadex";
import { runWeeb } from "../../../backend/weeb";
import { createCbz } from "../../../backend/cbz";
import { recordDownload } from "../../../backend/tracked";

export async function POST(req: Request) {
  const body = await req.json();
  const manga = body.manga;
  if (!manga) return NextResponse.json({ error: "manga required" }, { status: 400 });
  const job = createJob(body);

  // Start background work without blocking response
  (async () => {
    setJobRunning(job.id);
    try {
      // detect source
      const text = String(manga).toLowerCase();
      if (text.includes("mangadex.org") || extractUuidFromUrl(manga)) {
        const res = await downloadMdChapters(manga, body.md_lang || "en", body.outDir);
        // optionally record
        try {
          recordDownload({ manga_name: manga, latest_chapter_local: 0, latest_chapter_from_mangadex: 0 });
        } catch (_) {}
        setJobFinished(job.id, res);
        return;
      }

      if (text.includes("weebcentral")) {
        const res = await runWeeb(manga, body);
        if (body.cbz && res?.outDir) {
          try {
            await createCbz(res.outDir);
          } catch (_e) {}
        }
        setJobFinished(job.id, res);
        return;
      }

      // generic
      const slug = String(manga).replace(/\s+/g, "-");
      const urls = await gatherUrls(slug, body);
      if (!urls || urls.length === 0) {
        setJobFinished(job.id, { downloaded: 0 });
        return;
      }
      const folder = body.outDir || String(manga).replace(/\s+/g, "_");
      const results = await downloadUrls(urls, folder, body.workers || 5);
      if (body.cbz) {
        try { await createCbz(folder); } catch (_e) {}
      }
      setJobFinished(job.id, { downloaded: results.length, folder });
    } catch (e) {
      setJobFailed(job.id, e);
    }
  })();

  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
