import {
  validateMangaURL,
  defineTypeOfURL,
  getMangaDexInfoFromURL,
  extractMangaDexUUID,
  getChapterIdFromURLWeebCentral,
  sanitizeFileName,
  returnGlobFromURL,
  createFolderForManga,
  getChapterIDForMangaDex,
} from "./utils";

import { getCoverFromMangadex } from "@/app/backend/mangadex/getCoverFromMangadex";
import { downloadAllChaptersForMangaDex } from "@/app/backend/mangadex/downloadChapterImagesFromMangadex";

const test_urls = [
  "https://mangadex.org/title/ed996855-70de-449f-bba2-e8e24224c14d/onii-chan-wa-oshimai",
  "https://weebcentral.com/chapters/12345",
  "https://scans.lastation.us/manga/some-manga/1.0-1.png",
  "https://invalidurl.com/somepath",
];

async function runTests() {
  for (const url of test_urls) {
    console.log(`\nTesting URL: ${url}`);

    const isValid = validateMangaURL(url);
    const type = defineTypeOfURL(url);

    console.log(`Is valid: ${isValid}`);
    console.log(`Type: ${type}`);

    // =========================
    // MangaDex tests
    // =========================
    if (type === "mangadex") {
      const info = getMangaDexInfoFromURL(url);
      const uuid = extractMangaDexUUID(url);

      console.log(`MangaDex Info: ${JSON.stringify(info)}`);
      console.log(`MangaDex UUID: ${uuid}`);

      if (uuid) {
        try {
          console.log("Fetching cover...");
          const cover = await getCoverFromMangadex(uuid);
          console.log(`Cover URL: ${cover}`);
        } catch (err) {
          console.log(
            "Cover fetch failed:",
            err instanceof Error ? err.message : err
          );
        }

        try {
          console.log("Downloading all chapters...");
          const results = await downloadAllChaptersForMangaDex(
            uuid,
            `./downloads/${uuid}`,
            false,
            "en"
          );
          console.log(`Total chapters downloaded: ${results.length}`);
        } catch (err) {
          console.log(
            "Download failed:",
            err instanceof Error ? err.message : err
          );
        }
      }
    }

    // =========================
    // WeebCentral tests
    // =========================
    if (type === "weebcentral") {
      console.log(
        `WeebCentral Chapter ID: ${getChapterIdFromURLWeebCentral(url)}`
      );
    }

    // =========================
    // Utils tests
    // =========================
    console.log(
      `Sanitized File Name: ${sanitizeFileName("  some   file name?.png  ")}`
    );

    console.log(`Glob Pattern: ${returnGlobFromURL(url)}`);

    console.log("---");
  }
}

runTests();
