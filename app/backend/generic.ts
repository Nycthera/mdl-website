import fs from "fs";
import path from "path";

async function head(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    return res.ok;
  } catch (_e) {
    return false;
  }
}

export async function gatherUrls(slug: string, opts: any) {
  const BASE_URLS = [
    "https://scans.lastation.us/manga/",
    "https://official.lowee.us/manga/",
    "https://hot.planeptune.us/manga/",
    "https://scans-hot.planeptune.us/manga/",
  ];
  const start = opts.start_chapter || 1;
  const maxChapters = (opts.max_chapters || 5) + start;
  const chapterNumbers = Array.from(
    { length: maxChapters - start },
    (_, index) => start + index,
  );
  const chapters = await Promise.all(
    chapterNumbers.map(async (chapter) => {
      const chapterStr = String(chapter).padStart(4, "0");
      const probes = await Promise.all(
        BASE_URLS.map(async (base) => ({
          base,
          exists: await head(`${base}${slug}/${chapterStr}-001.png`),
        })),
      );
      let foundBase: string | undefined;
      for (const probe of probes) {
        if (probe.exists) {
          foundBase = probe.base;
          break;
        }
      }
      return { chapterStr, foundBase };
    }),
  );
  const urls: Array<[string, string]> = [];
  for (const { chapterStr, foundBase } of chapters) {
    if (!foundBase) {
      break;
    }
    const pages = opts.max_pages || 50;
    for (let p = opts.start_page || 1; p <= pages; p++) {
      const pageStr = String(p).padStart(3, "0");
      urls.push([
        `${foundBase}${slug}/${chapterStr}-${pageStr}.png`,
        `chapter_${chapterStr}`,
      ]);
    }
  }
  return urls;
}

export async function downloadUrls(urls: Array<[string, string]>, baseFolder: string, concurrency = 5) {
  fs.mkdirSync(baseFolder, { recursive: true });
  async function runBatch(startIndex: number): Promise<Array<any>> {
    const batch = urls.slice(startIndex, startIndex + concurrency);
    if (!batch.length) {
      return [];
    }
    const batchResults = await Promise.all(
      batch.map(async ([url, folder]) => {
        const dir = path.join(baseFolder, folder);
        fs.mkdirSync(dir, { recursive: true });
        try {
          const res = await fetch(url);
          if (!res.ok) return { url, ok: false, status: res.status };
          const buf = Buffer.from(await res.arrayBuffer());
          const filename = path.basename(url);
          fs.writeFileSync(path.join(dir, filename), buf);
          return { url, ok: true };
        } catch (e) {
          return { url, ok: false, error: String(e) };
        }
      }),
    );
    return batchResults.concat(await runBatch(startIndex + concurrency));
  }

  return runBatch(0);
}
