import fs from "fs";
import path from "path";

async function fetchJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} failed ${res.status}`);
  return res.json();
}

export async function fetchAllChapters(mangaUuid: string, lang = "en") {
  const chapters: any[] = [];
  const limit = 100;
  const firstPage = await fetchJson(
    `https://api.mangadex.org/chapter?manga=${mangaUuid}&translatedLanguage[]=${lang}&limit=${limit}&offset=0&order[chapter]=asc`,
  );
  const firstBatch = firstPage.data || [];
  chapters.push(...firstBatch);
  const total = firstPage.total || 0;
  const remainingOffsets: number[] = [];
  for (let offset = limit; offset < total; offset += limit) {
    remainingOffsets.push(offset);
  }
  const remainingPages = await Promise.all(
    remainingOffsets.map((offset) =>
      fetchJson(
        `https://api.mangadex.org/chapter?manga=${mangaUuid}&translatedLanguage[]=${lang}&limit=${limit}&offset=${offset}&order[chapter]=asc`,
      ),
    ),
  );
  for (const page of remainingPages) {
    chapters.push(...(page.data || []));
  }
  return chapters;
}

export function extractUuidFromUrl(mangaUrl: string): string | null {
  try {
    const u = new URL(mangaUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[0] === "title" && parts[1]) return parts[1];
  } catch (_e) {}
  return null;
}

export async function downloadMdChapters(mangaUrl: string, lang = "en", outDir?: string) {
  const uuid = extractUuidFromUrl(mangaUrl);
  if (!uuid) throw new Error("invalid mangadex url");
  const chapters = await fetchAllChapters(uuid, lang);
  const base = path.resolve(outDir || `mangadex_${uuid}`);
  fs.mkdirSync(base, { recursive: true });
  await Promise.all(
    chapters.map(async (ch) => {
      const chapId = ch.id;
      const attr = ch.attributes || {};
      const chapNum = attr.chapter || "unknown";
      try {
        const info = await fetchJson(`https://api.mangadex.org/at-home/server/${chapId}`);
        const chapterData = info.chapter || {};
        const baseUrl = info.baseUrl;
        const hash = chapterData.hash;
        const pages = chapterData.data || chapterData.dataSaver || [];
        const folder = path.join(base, `Chapter_${String(chapNum).replace(/\s+/g, "_")}`);
        fs.mkdirSync(folder, { recursive: true });
        pages.forEach((p: string, idx: number) => {
          const url = `${baseUrl}/data/${hash}/${p}`;
          fs.writeFileSync(path.join(folder, `${String(idx + 1).padStart(3, "0")}.url.txt`), url + "\n");
        });
      } catch (_e) {
        // skip chapter on error
      }
    }),
  );
  return { chapters: chapters.length, outDir: base };
}
