export interface AtHomeResponse {
  baseUrl: string;
  chapter: {
    hash: string;
    data: string[];
    dataSaver: string[];
    [key: string]: any;
  };
}

export interface ChapterImagesResult {
  baseUrl: string;
  hash: string;
  pages: string[];
  fullUrls: string[];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Global pacing between MangaDex API requests
let lastRequest = 0;

async function mangaDexFetch(url: string, retries = 5): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const elapsed = Date.now() - lastRequest;

    if (elapsed < 1000) {
      await sleep(1000 - elapsed);
    }

    const response = await fetch(url);
    lastRequest = Date.now();

    if (response.status !== 429) {
      return response;
    }

    const retryAfter = Number(response.headers.get("retry-after")) || 15;

    console.log(`[429] MangaDex rate limited. Waiting ${retryAfter}s...`);

    await sleep(retryAfter * 1000);
  }

  throw new Error("Exceeded MangaDex retry limit");
}

export async function getChapterImagesFromMangaDex(
  chapterId: string,
  useSaver = false
): Promise<ChapterImagesResult> {
  const response = await mangaDexFetch(
    `https://api.mangadex.org/at-home/server/${chapterId}`
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch chapter images (${response.status})`);
  }

  const data: AtHomeResponse = await response.json();

  const baseUrl = data.baseUrl;
  const hash = data.chapter.hash;

  const pages =
    useSaver && data.chapter.dataSaver.length
      ? data.chapter.dataSaver
      : data.chapter.data;

  const folder = useSaver ? "data-saver" : "data";

  const fullUrls = pages.map((page) => `${baseUrl}/${folder}/${hash}/${page}`);

  return {
    baseUrl,
    hash,
    pages,
    fullUrls,
  };
}

export async function getAllChapterIDsForMangaDex(
  mangaId: string,
  language = "en"
): Promise<string[]> {
  const chapterIds: string[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const res = await mangaDexFetch(
      `https://api.mangadex.org/manga/${mangaId}/feed?limit=${limit}&offset=${offset}&translatedLanguage[]=${language}&order[chapter]=asc`
    );

    if (!res.ok) {
      throw new Error(`Failed to fetch chapters (${res.status})`);
    }

    const data = await res.json();

    chapterIds.push(...data.data.map((chapter: any) => chapter.id));

    if (offset + limit >= data.total) {
      break;
    }

    offset += limit;
  }

  return chapterIds;
}
