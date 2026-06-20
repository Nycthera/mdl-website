// /api/v1/resolveManual/route.ts
import { findCoverImageURL } from "@/app/backend/manual/scrapping/getCoverImageURLFromManualURL";
import { returnGlobFromURL } from "@/app/backend/utils";

export async function POST(req: Request) {
  const { mangaUrl } = await req.json();

  const coverUrl = await findCoverImageURL(mangaUrl);

  if (!coverUrl) {
    return new Response(
      JSON.stringify({ error: "Could not resolve manga from URL" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  const slug = returnGlobFromURL(mangaUrl);
  const mangaName = slug
    ? slug
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ")
    : "Unknown Manga";

  return Response.json({ mangaName, coverUrl });
}
