// app/api/v1/mangadex/cover/route.ts

import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/get-session";
import { getCoverFromMangadex } from "@/app/backend/mangadex/scraping/getCoverFromMangadex";

export const runtime = "nodejs";
export const maxDuration = 15;

const MANGADEX_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  // ── Auth ────────────────────────────────────────────────────────
  // Every other data-fetching route under /api/v1 requires a session;
  // this one didn't, which made it a free, unauthenticated way for
  // anyone (no account, no rate limit) to make this server hammer
  // MangaDex's API on their behalf. Bring it in line with the rest.
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const mangaId = searchParams.get("mangaId")?.trim();

  if (!mangaId) {
    return NextResponse.json({ error: "Missing mangaId" }, { status: 400 });
  }

  // Reject non-UUIDs before we even call the backend function — cheap
  // input validation belongs at the edge, not several layers deep.
  if (!MANGADEX_UUID_REGEX.test(mangaId)) {
    return NextResponse.json({ error: "invalid mangaId" }, { status: 400 });
  }

  let coverUrl: string | null;
  try {
    coverUrl = await getCoverFromMangadex(mangaId);
  } catch (err) {
    // PREVIOUSLY this let getCoverFromMangadex's exception escape
    // uncaught, which Next.js turns into an opaque 500 with no
    // response body — the client had no way to distinguish "MangaDex
    // is down" from "MangaDex doesn't have this manga".
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "failed to fetch cover",
      },
      { status: 502 },
    );
  }

  if (!coverUrl) {
    return NextResponse.json({ error: "Cover not found" }, { status: 404 });
  }

  return NextResponse.json({ coverUrl });
}
