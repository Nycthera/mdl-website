type URLType = "mangadex" | "weebcentral" | "lastation" | null;

export function validateMangaURL(url: string): boolean {
  const regex =
    /^https?:\/\/(?:weebcentral\.com\/chapters\/[^/]+|mangadex\.org\/title\/[0-9a-fA-F-]+\/[^/]+|scans\.lastation\.us\/manga\/[^/]+\/\d+(?:\.\d+)?-\d+\.png)$/;

  return regex.test(url);
}

export function defineTypeOfURL(url: string): URLType {
  if (url.includes("mangadex.org/title/")) return "mangadex";
  if (url.includes("weebcentral.com/chapters/")) return "weebcentral";
  if (url.includes("scans.lastation.us/manga/")) return "lastation";
  return null;
}

/**
 * Mangadex:
 * https://mangadex.org/title/<id>/<slug>
 */
export function getMangaDexInfoFromURL(url: string): {
  id: string;
  name: string;
} {
  const match = url.match(
    /^https?:\/\/mangadex\.org\/title\/([0-9a-fA-F-]+)\/([^/?#]+)/
  );

  if (!match) {
    return { id: "Unknown ID", name: "Unknown Manga" };
  }

  const id = match[1];
  const slug = match[2];

  const name = slug
    .replace(/--/g, " ") // double hyphens → space (Mangadex style)
    .replace(/-/g, " ") // hyphens → space
    .replace(/\b\w/g, (c) => c.toUpperCase()); // title case

  return { id, name };
}

export function getChapterIdFromURLWeebCentral(url: string): string {
  const match = url.match(/^https?:\/\/weebcentral\.com\/chapters\/([^/?#]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : "Unknown Chapter ID";
}

export function sanitizeFileName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function returnGlobFromURL(url: string): string {
  if (url.endsWith(".png")) return "*.png";
  if (url.endsWith(".jpg") || url.endsWith(".jpeg")) return "*.jpg";
  if (url.endsWith(".webp")) return "*.webp";
  return "*";
}

export function createFolderForManga(mangaTitle: string): string {
  return sanitizeFileName(mangaTitle).replace(/\s+/g, "_").toLowerCase();
}

