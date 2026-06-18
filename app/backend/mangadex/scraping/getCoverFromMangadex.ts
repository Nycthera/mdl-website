// backend/mangadex/scraping/getCoverFromMangadex.ts

export type CoverSize = "original" | "256" | "512";

export async function getCoverFromMangadex(
  mangaId: string,
  size: CoverSize = "original"
): Promise<string | null> {
  const res = await fetch(
    `https://api.mangadex.org/manga/${mangaId}?includes[]=cover_art`
  );

  if (!res.ok) {
    throw new Error(`Failed to fetch manga ${mangaId}`);
  }

  const json = await res.json();

  const cover = json.data.relationships.find(
    (r: any) => r.type === "cover_art"
  );

  const fileName = cover?.attributes?.fileName;

  if (!fileName) {
    return null;
  }

  const base = `https://uploads.mangadex.org/covers/${mangaId}/${fileName}`;

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
