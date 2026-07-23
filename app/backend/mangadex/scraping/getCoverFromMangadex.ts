// backend/mangadex/scraping/getCoverFromMangadex.ts

const MANGADEX_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CoverSize = "original" | "256" | "512";

interface MangadexRelationship {
  type: string;
  attributes?: { fileName?: string };
}

interface MangadexMangaResponse {
  data?: { relationships?: MangadexRelationship[] };
}

/**
 * Resolves a MangaDex cover image URL for `mangaId`.
 *
 * Returns null when the manga has no cover_art relationship or the
 * response doesn't look like the shape we expect (rather than throwing
 * on a malformed/unexpected API response — MangaDex's API is
 * unversioned-in-practice and has changed shape before).
 *
 * Throws only for transport/HTTP failures (network error, non-2xx),
 * which is a genuinely exceptional condition the caller should
 * surface as a 502, not a "cover not found" 404.
 */
export async function getCoverFromMangadex(
  mangaId: string,
  size: CoverSize = "original",
): Promise<string | null> {
  // mangaId ends up directly in a URL path segment. It's also always
  // attacker-controlled here — this function is called straight from
  // an API route with a query-string value. Reject anything that
  // isn't a real MangaDex UUID before it goes anywhere near `fetch`,
  // instead of trusting the caller to have validated it.
  if (!MANGADEX_UUID_REGEX.test(mangaId)) {
    throw new Error(`invalid MangaDex manga id: ${mangaId}`);
  }

  const res = await fetch(
    `https://api.mangadex.org/manga/${mangaId}?includes[]=cover_art`,
    { signal: AbortSignal.timeout(10_000) },
  );

  if (!res.ok) {
    throw new Error(`Failed to fetch manga ${mangaId}: HTTP ${res.status}`);
  }

  let json: MangadexMangaResponse;
  try {
    json = await res.json();
  } catch {
    throw new Error(`MangaDex returned a non-JSON response for ${mangaId}`);
  }

  const cover = json.data?.relationships?.find(
    (r) => r.type === "cover_art",
  );

  const fileName = cover?.attributes?.fileName;

  if (!fileName) {
    return null;
  }

  const base = `https://uploads.mangadex.org/covers/${mangaId}/${encodeURIComponent(fileName)}`;

  switch (size) {
    case "256":
      return `${base}.256.jpg`;

    case "512":
      return `${base}.512.jpg`;

    case "original":
    default:
      return base;
  }
}
