// /api/v1/manga/[id]/mangadex-id/route.ts
//
// Links (or clears) the MangaDex series a manga_data row should be
// checked against. Accepts either a bare MangaDex UUID or a full
// mangadex.org/title/<uuid>/... URL for convenience — reuses the same
// URL parsing the download pipeline already uses.
import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/get-session";
import { setMangaDataMangadexId } from "@/app/backend/supabaseFunctions/getMangaInfo/getMangaInfo";
import { getMangaDexInfoFromURL } from "@/app/backend/utils";

const MANGADEX_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const mangaDataId = Number(id);
  if (!Number.isInteger(mangaDataId)) {
    return NextResponse.json({ error: "invalid manga id" }, { status: 400 });
  }

  let body: { mangadexId?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  // Explicit null clears the link.
  if (body.mangadexId === null) {
    await setMangaDataMangadexId(mangaDataId, null);
    return NextResponse.json({ mangadexId: null });
  }

  const raw = body.mangadexId?.trim();
  if (!raw) {
    return NextResponse.json(
      { error: "mangadexId is required" },
      { status: 400 },
    );
  }

  const mangadexId = MANGADEX_UUID_RE.test(raw)
    ? raw
    : getMangaDexInfoFromURL(raw).id;

  if (!MANGADEX_UUID_RE.test(mangadexId)) {
    return NextResponse.json(
      { error: "not a valid MangaDex id or /title/ URL" },
      { status: 400 },
    );
  }

  await setMangaDataMangadexId(mangaDataId, mangadexId);
  return NextResponse.json({ mangadexId });
}
