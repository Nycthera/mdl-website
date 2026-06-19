import {
  getChapterImagesFromMangaDex,
  getAllChapterIDsForMangaDex,
} from "@/app/backend/mangadex/scraping/getChapterImagesFromMangadex";
import { getMangaDexInfoFromURL } from "@/app/backend/utils";

interface MangaChapterInput {
  label: string;
  imageUrls: string[];
}
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function makeResultsIntoArrayFormatForDownloadFunction(
  mangaUrl: string
): Promise<MangaChapterInput[]> {
  const manga = getMangaDexInfoFromURL(mangaUrl);

  const chapterIds = await getAllChapterIDsForMangaDex(manga.id);

  const chapters: MangaChapterInput[] = [];

  for (let i = 0; i < chapterIds.length; i++) {
    console.log(`[${i + 1}/${chapterIds.length}] ${chapterIds[i]}`);

    const chapterImages = await getChapterImagesFromMangaDex(chapterIds[i]);

    chapters.push({
      label: String(i + 1).padStart(4, "0"),
      imageUrls: chapterImages.fullUrls,
    });

    // Small delay between chapter API requests
    await sleep(250);
  }

  return chapters;
}
