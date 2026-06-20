import axios from "axios";
import { returnGlobFromURL } from "@/app/backend/utils";

const baseUrls = [
  "https://scans.lastation.us/manga/",
  "https://official.lowee.us/manga/",
  "https://hot.planeptune.us/manga/",
  "https://scans-hot.planeptune.us/manga/",
];

export async function findCoverImageURL(
  inputUrl: string
): Promise<string | null> {
  const mangaSlug = returnGlobFromURL(inputUrl);

  if (!mangaSlug) {
    return null;
  }

  for (const baseUrl of baseUrls) {
    const candidateUrl = `${baseUrl}${mangaSlug}/0001-001.png`;

    try {
      const response = await axios.get(candidateUrl, {
        validateStatus: () => true,
        responseType: "stream",
        timeout: 8000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
          Referer: "https://mangadex.org/",
          Accept:
            "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
      });

      console.log(`[findCoverImageURL] ${candidateUrl} -> ${response.status}`);

      if (response.status === 200) {
        return candidateUrl;
      }
    } catch (err) {
      console.error(
        `[findCoverImageURL] ${candidateUrl} -> ERROR`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return null;
}
