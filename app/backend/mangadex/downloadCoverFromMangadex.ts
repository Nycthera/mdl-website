import { sanitizeFileName } from "@/app/backend/utils";

export async function downloadImagesForChapterMangadex(
  baseUrl: string,
  hash: string,
  pages: string[],
  outputDir: string
) {
  const fs = await import("fs");
  const path = await import("path");

  fs.mkdirSync(outputDir, { recursive: true });

  const downloaded: string[] = [];

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];

    //  FIX: if already full URL, use it directly
    const imageUrl = page.startsWith("http")
      ? page
      : `${baseUrl.replace(/\/$/, "")}/data/${hash}/${page}`;

    const fileName = `${String(i + 1).padStart(3, "0")}-${page
      .split("/")
      .pop()}`;

    const filePath = path.join(outputDir, sanitizeFileName(fileName));

    try {
      const res = await fetch(imageUrl);

      if (!res.ok) {
        console.log("Failed:", imageUrl);
        continue;
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(filePath, buffer);

      downloaded.push(filePath);
    } catch (e) {
      console.log("Error:", imageUrl, e);
    }
  }

  return downloaded;
}
