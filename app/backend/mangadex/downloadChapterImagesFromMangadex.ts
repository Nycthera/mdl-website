import { sanitizeFileName } from "@/app/backend/utils";
import fs from "fs";
import path from "path";
import {
  getChapterImagesFromMangaDex,
  getAllChapterIDsForMangaDex,
} from "@/app/backend/mangadex/scraping/getChapterImagesFromMangadex";

export async function downloadImagesForChapterMangadex(
  imageUrls: string[],
  outputDir: string
) {
  fs.mkdirSync(outputDir, { recursive: true });

  const downloaded: string[] = [];

  for (let i = 0; i < imageUrls.length; i++) {
    const imageUrl = imageUrls[i];

    const fileName = sanitizeFileName(
      `${String(i + 1).padStart(3, "0")}-${imageUrl.split("/").pop()}`
    );

    const filePath = path.join(outputDir, fileName);

    try {
      const res = await fetch(imageUrl);

      if (!res.ok) {
        console.log("Failed:", imageUrl);
        continue;
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(filePath, buffer);

      downloaded.push(filePath);
    } catch (err) {
      console.log("Error:", imageUrl, err);
    }
  }

  return downloaded;
}

export async function downloadAllChaptersForMangaDex(
  mangaId: string,
  outputBaseDir: string,
  useSaver = false,
  language = "en"
) {
  console.log(`Fetching all chapter IDs for manga: ${mangaId}`);
  const chapterIds = await getAllChapterIDsForMangaDex(mangaId, language);
  console.log(`Found ${chapterIds.length} chapters`);

  const results: { chapterId: string; files: string[] }[] = [];

  for (let i = 0; i < chapterIds.length; i++) {
    const chapterId = chapterIds[i];
    const chapterDir = path.join(
      outputBaseDir,
      sanitizeFileName(`chapter-${String(i + 1).padStart(4, "0")}-${chapterId}`)
    );

    console.log(
      `\n[${i + 1}/${chapterIds.length}] Downloading chapter: ${chapterId}`
    );

    try {
      const { fullUrls } = await getChapterImagesFromMangaDex(
        chapterId,
        useSaver
      );
      console.log(`  Images found: ${fullUrls.length}`);

      const files = await downloadImagesForChapterMangadex(
        fullUrls,
        chapterDir
      );
      console.log(`  Downloaded: ${files.length} files`);

      results.push({ chapterId, files });
    } catch (err) {
      console.log(
        `  Failed chapter ${chapterId}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return results;
}
