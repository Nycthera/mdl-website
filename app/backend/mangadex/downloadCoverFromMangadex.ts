// backend/mangadex/downloadCoverFromMangadex.ts

export type CoverSize = "original" | "256" | "512";

export async function downloadCoverFromMangadex(
  mangaId: string,
  fileName: string,
  size: CoverSize = "original"
): Promise<Blob> {
  let url = `https://uploads.mangadex.org/covers/${mangaId}/${fileName}`;

  switch (size) {
    case "256":
      url += ".256.jpg";
      break;

    case "512":
      url += ".512.jpg";
      break;

    case "original":
    default:
      break;
  }

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Failed to download cover from ${url}`);
  }

  return await res.blob();
}
