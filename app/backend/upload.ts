// upload.ts

import fs from "node:fs";
import { Readable } from "node:stream";

import { buildMangaCbzStream } from "@/app/backend/downloadLogicForManualAndWeebcentral/download";

import { makeResultsIntoArrayFormatForDownloadFunction } from "@/app/backend/mangadex/makeResultsIntoArrayFormatForDownloadFunction";

async function test() {
  const chapters = await makeResultsIntoArrayFormatForDownloadFunction(
    "https://mangadex.org/title/ed996855-70de-449f-bba2-e8e24224c14d/onii-chan-wa-oshimai"
  );

  console.log(`Loaded ${chapters.length} chapters`);

  const stream = await buildMangaCbzStream({
    mangaName: "Onii-chan wa Oshimai",
    chapters,
    maxWorkers: 2, // recommended for MangaDex
  });

  const nodeStream = Readable.fromWeb(stream as any);

  const output = fs.createWriteStream("./Onii-chan wa Oshimai.cbz");

  nodeStream.pipe(output);

  await new Promise<void>((resolve, reject) => {
    output.on("finish", resolve);
    output.on("error", reject);
  });

  console.log("CBZ saved successfully");
}

test().catch(console.error);
