import axios from "axios";
import { returnGlobFromURL } from "@/app/backend/utils";

const baseUrls = [
  "https://scans.lastation.us/manga/",
  "https://official.lowee.us/manga/",
  "https://hot.planeptune.us/manga/",
  "https://scans-hot.planeptune.us/manga/",
];

const client = axios.create({
  timeout: 5000,
  validateStatus: () => true,
});

const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  Referer: "https://mangadex.org/",
  Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
};

async function findWorkingUrl(candidates: string[]): Promise<string | null> {
  try {
    return await Promise.any(
      candidates.map(async (url) => {
        const res = await client.get(url, {
          responseType: "stream",
          headers: REQUEST_HEADERS,
        });

        if (res.status >= 200 && res.status < 400) return url;
        throw new Error(`Bad status ${res.status}`);
      })
    );
  } catch {
    return null;
  }
}

export async function gatherAllUrlsFromSample(
  sampleUrl: string,
  maxChapters = 2000,
  maxPages = 100
): Promise<string[]> {
  const mangaName = returnGlobFromURL(sampleUrl);
  if (!mangaName) throw new Error("Invalid manga URL");

  const urls: string[] = [];

  for (let chapter = 1; chapter <= maxChapters; chapter++) {
    const chapterStr = chapter.toString().padStart(4, "0");

    const firstPageUrl = await findWorkingUrl(
      baseUrls.map((base) => `${base}${mangaName}/${chapterStr}-001.png`)
    );

    if (!firstPageUrl) break;

    urls.push(firstPageUrl);

    // Fetch all remaining pages concurrently
    const pageResults = await Promise.all(
      Array.from({ length: maxPages - 1 }, (_, i) => {
        const pageStr = (i + 2).toString().padStart(3, "0");
        return findWorkingUrl(
          baseUrls.map(
            (base) => `${base}${mangaName}/${chapterStr}-${pageStr}.png`
          )
        );
      })
    );

    for (const url of pageResults) {
      if (!url) break;
      urls.push(url);
    }
  }

  return urls;
}
