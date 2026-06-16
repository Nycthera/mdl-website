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

export async function getChapterImagesFromMangaDex(
  chapterId: string,
  useSaver = false
): Promise<ChapterImagesResult> {
  const response = await fetch(
    `https://api.mangadex.org/at-home/server/${chapterId}`
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch chapter images (${response.status})`);
  }

  const data: AtHomeResponse = await response.json();

  const baseUrl = data.baseUrl;
  const hash = data.chapter?.hash;

  if (!baseUrl || !hash) {
    throw new Error("Invalid MangaDex at-home response");
  }

  const pages =
    useSaver && data.chapter?.dataSaver?.length
      ? data.chapter.dataSaver
      : data.chapter?.data || [];

  const fullUrls = pages.map((page) => `${baseUrl}/data/${hash}/${page}`);

  return { baseUrl, hash, pages, fullUrls };
}

export async function getAllChapterIDsForMangaDex(
  mangaId: string,
  language = "en"
): Promise<string[]> {
  const chapterIds: string[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const url = `https://api.mangadex.org/manga/${mangaId}/feed?limit=${limit}&offset=${offset}&translatedLanguage[]=${language}&order[chapter]=asc`;
    const res = await fetch(url);

    if (!res.ok) throw new Error(`Failed to fetch chapters (${res.status})`);

    const data = await res.json();
    const batch: string[] = data.data.map((ch: any) => ch.id);

    chapterIds.push(...batch);

    if (offset + limit >= data.total) break;
    offset += limit;
  }

  return chapterIds;
}
