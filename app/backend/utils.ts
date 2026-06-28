import axios from "axios";

export type URLType = "mangadex" | "weebcentral" | "manual" | null;

const MANGADEX_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateMangaURL(url: string): boolean {
  try {
    const parsed = new URL(url);

    // MangaDex
    if (parsed.hostname === "mangadex.org") {
      const parts = parsed.pathname.split("/").filter(Boolean);

      return (
        parts.length >= 3 &&
        parts[0] === "title" &&
        MANGADEX_UUID_REGEX.test(parts[1])
      );
    }

    // WeebCentral — either a single chapter (we'll auto-discover its
    // series) or a series URL directly.
    if (parsed.hostname === "weebcentral.com") {
      const parts = parsed.pathname.split("/").filter(Boolean);

      return (
        parts.length >= 2 && (parts[0] === "chapters" || parts[0] === "series")
      );
    }

    // Lastation
    if (parsed.hostname === "scans.lastation.us") {
      return /^\/manga\/[^/]+\/\d+(?:\.\d+)?-\d+\.png$/i.test(parsed.pathname);
    }

    return false;
  } catch {
    return false;
  }
}

export function defineTypeOfURL(url: string): URLType {
  const baseUrls = [
    "https://scans.lastation.us/manga/",
    "https://official.lowee.us/manga/",
    "https://hot.planeptune.us/manga/",
    "https://scans-hot.planeptune.us/manga/",
  ];

  try {
    const parsed = new URL(url);

    switch (parsed.hostname) {
      case "mangadex.org":
        return "mangadex";

      case "weebcentral.com":
        return "weebcentral";

      default: {
        // check if URL starts with any base URL
        const isManual = baseUrls.some((base) => url.startsWith(base));

        if (isManual) return "manual";

        return null;
      }
    }
  } catch {
    return null;
  }
}

/**
 * MangaDex:
 * https://mangadex.org/title/<uuid>/<slug>
 */
export function getMangaDexInfoFromURL(url: string): {
  id: string;
  name: string;
} {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);

    if (
      parts.length < 3 ||
      parts[0] !== "title" ||
      !MANGADEX_UUID_REGEX.test(parts[1])
    ) {
      return {
        id: "Unknown ID",
        name: "Unknown Manga",
      };
    }

    const id = parts[1];
    const slug = parts[2];

    const name = decodeURIComponent(slug)
      .replace(/--/g, " ")
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

    return {
      id,
      name,
    };
  } catch {
    return {
      id: "Unknown ID",
      name: "Unknown Manga",
    };
  }
}

/**
 * Equivalent to the Python:
 *
 * path = urlparse(url).path.strip("/")
 * parts = path.split("/")
 * if parts[0] == "title":
 *     return parts[1]
 */
export function extractMangaDexUUID(url: string): string | null {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);

    if (
      parts[0] !== "title" ||
      !parts[1] ||
      !MANGADEX_UUID_REGEX.test(parts[1])
    ) {
      return null;
    }

    return parts[1];
  } catch {
    return null;
  }
}

export function getChapterIdFromURLWeebCentral(url: string): string {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);

    if (parts.length < 2 || parts[0] !== "chapters") {
      return "Unknown Chapter ID";
    }

    // Returns everything after /chapters/
    return decodeURIComponent(parts.slice(1).join("/"));
  } catch {
    return "Unknown Chapter ID";
  }
}
export function sanitizeFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function returnGlobFromURL(url: string): string | null {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);

    // /manga/Wistoria-Wand-and-Sword/0065-001.png
    if (parts.length < 2 || parts[0] !== "manga") {
      return null;
    }

    return parts[1];
  } catch {
    return null;
  }
}

export function createFolderForManga(mangaTitle: string): string {
  return sanitizeFileName(mangaTitle).replace(/\s+/g, "_").toLowerCase();
}

export async function getChapterIDForMangaDex(
  url: string,
  mangaID: string
): Promise<string | null> {
  const baseUrl = "https://api.mangadex.org";

  const resp = await axios.get(`${baseUrl}/manga/${mangaID}/feed`, {
    params: {
      "translatedLanguage[]": "en",
      limit: 1,
      "order[chapter]": "asc",
    },
  });

  const chapters = resp.data?.data;

  if (!chapters || chapters.length === 0) return null;

  return chapters[0].id;
}
