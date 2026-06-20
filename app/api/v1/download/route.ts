// /api/v1/download/route.ts
import {
  buildMangaCbzStream,
  getCbzFilename,
  groupUrlsByChapter,
} from "@/app/backend/downloadLogicForManualAndWeebcentral/download";
import { gatherAllUrlsFromSample } from "@/app/backend/manual/scrapping/getAllImagesFromManual";
import { makeResultsIntoArrayFormatForDownloadFunction } from "@/app/backend/mangadex/makeResultsIntoArrayFormatForDownloadFunction";

export async function POST(req: Request) {
  const { mangaUrl, mangaName, source } = await req.json();

  let chapters;

  if (source === "manual") {
    const pageUrls = await gatherAllUrlsFromSample(mangaUrl);

    if (pageUrls.length === 0) {
      return new Response(
        JSON.stringify({ error: "No chapters found for this manga" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    chapters = groupUrlsByChapter(pageUrls);
  } else if (source === "mangadex") {
    chapters = await makeResultsIntoArrayFormatForDownloadFunction(mangaUrl);
  } else {
    return new Response(
      JSON.stringify({ error: `Unsupported source: ${source}` }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const stream = buildMangaCbzStream({
    mangaName,
    chapters,
    maxWorkers: 2,
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/vnd.comicbook+zip",
      "Content-Disposition": `attachment; filename="${getCbzFilename(mangaName)}"`,
    },
  });
}
