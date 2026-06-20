// /api/v1/resolveWeebcentral/route.ts
import { fetchManualImages } from "@/app/backend/weebcentral/scrapping/getImageURLFromInputURL";
import { findCoverImageURL } from "@/app/backend/manual/scrapping/getCoverImageURLFromManualURL";
import { returnGlobFromURL } from "@/app/backend/utils";

export async function POST(req: Request) {
  const { mangaUrl } = await req.json();

  const { imageUrls, title } = await fetchManualImages(mangaUrl);
  const firstImageUrl = imageUrls[0];

  if (!firstImageUrl) {
    return new Response(
      JSON.stringify({ error: "Could not find any images for this manga" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  // Confirm the resolved mirror URL actually has chapter 1 available
  // (same check `manual` sources go through), and derive the canonical
  // manga name from the slug rather than trusting the scraped title.
  const coverUrl = await findCoverImageURL(firstImageUrl);

  if (!coverUrl) {
    return new Response(
      JSON.stringify({ error: "Could not resolve manga from URL" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  const slug = returnGlobFromURL(firstImageUrl);
  const mangaName = slug
    ? slug
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ")
    : title || "Unknown Manga";

  return Response.json({ mangaName, downloadUrl: firstImageUrl });
}
