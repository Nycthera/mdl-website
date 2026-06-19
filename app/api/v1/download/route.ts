// /api/v1/download/route.ts
import {
  buildMangaCbzStream,
  getCbzFilename,
} from "@/app/backend/downloadLogicForManualAndWeebcentral/download";

import { makeResultsIntoArrayFormatForDownloadFunction } from "@/app/backend/mangadex/makeResultsIntoArrayFormatForDownloadFunction";

export async function POST(req: Request) {
  const { mangaUrl, mangaName } = await req.json();

  const chapters =
    await makeResultsIntoArrayFormatForDownloadFunction(mangaUrl);

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
