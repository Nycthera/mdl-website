// /api/v1/check/route.ts
//
// Manual "Check now" (single manga) / "Check all" (whole library)
// entry point. Enqueues app/src/trigger/check-manga.ts and returns its
// run id for the frontend to poll via /api/v1/jobs/:id, same pattern
// as /api/v1/download.
import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/get-session";
import { getMangaDataForCheck } from "@/app/backend/supabaseFunctions/getMangaInfo/getMangaInfo";
import { enqueueCheck } from "@/app/src/trigger/check-manga";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { mangaDataIds?: number[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const ids = body.mangaDataIds;
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json(
      { error: "mangaDataIds must be a non-empty array" },
      { status: 400 },
    );
  }

  // Silently drops any id that has no mangadex_id linked yet — lets
  // "Check all" be called over the whole library without the frontend
  // pre-filtering which rows are linkable.
  const rows = await getMangaDataForCheck(ids);
  if (rows.length === 0) {
    return NextResponse.json(
      { error: "none of the requested manga have a linked MangaDex id" },
      { status: 400 },
    );
  }

  const runId = await enqueueCheck({
    userId,
    targets: rows.map((r) => ({
      mangaDataId: r.id,
      mangaName: r.manga_name,
      mangadexId: r.mangadex_id as string,
    })),
  });

  return NextResponse.json({ runId, checking: rows.length });
}
