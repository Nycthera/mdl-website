// app/api/v1/mangadex/cover/route.ts

import { NextResponse } from "next/server";
import { getCoverFromMangadex } from "@/app/backend/mangadex/scraping/getCoverFromMangadex";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const mangaId = searchParams.get("mangaId");

  if (!mangaId) {
    return NextResponse.json({ error: "Missing mangaId" }, { status: 400 });
  }

  const cover = await getCoverFromMangadex(mangaId);

  if (!cover) {
    return NextResponse.json({ error: "Cover not found" }, { status: 404 });
  }

  return NextResponse.json(cover);
}
