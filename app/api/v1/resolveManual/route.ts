// /api/v1/resolveManual/route.ts

import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/get-session";
import { findCoverImageURL } from "@/app/backend/manual/scrapping/getCoverImageURLFromManualURL";
import { defineTypeOfURL, returnGlobFromURL } from "@/app/backend/utils";

export const runtime = "nodejs";
export const maxDuration = 20;

export async function POST(req: Request) {
  // ── 1. Auth ──────────────────────────────────────────────────────
  // PREVIOUSLY this route had no auth check at all — anyone on the
  // internet, logged in or not, could POST any string here and make
  // this server fire off up to 4 outbound requests to third-party
  // scan-mirror hosts per call. That's a free, unauthenticated
  // amplification/DoS lever against both this server and the mirrors.
  // Every other route that triggers outbound scraping requires a
  // session — bring this one in line.
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ── 2. Parse + validate body ────────────────────────────────────
  // PREVIOUSLY: `const { mangaUrl } = await req.json()` with no
  // try/catch. A malformed body (or none at all) threw inside the
  // route handler and Next.js turned it into a bare 500 with no JSON
  // body — the client couldn't tell "bad request" from "server broke".
  let body: { mangaUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const mangaUrl = body.mangaUrl?.trim();
  if (!mangaUrl) {
    return NextResponse.json(
      { error: "mangaUrl is required" },
      { status: 400 },
    );
  }

  // PREVIOUSLY: no validation at all — mangaUrl went straight into
  // returnGlobFromURL/findCoverImageURL. Those only ever build request
  // URLs against a fixed allowlist of 4 mirror hosts, so this was never
  // an SSRF hole, but there was still nothing stopping a caller from
  // sending garbage that isn't even manga-shaped ("manual" source
  // URLs) and burning outbound requests for a guaranteed 404. Reject
  // anything that doesn't already look like a URL this app supports.
  if (defineTypeOfURL(mangaUrl) !== "manual") {
    return NextResponse.json(
      { error: "unsupported URL — must be a scan-mirror manga URL" },
      { status: 400 },
    );
  }

  let coverUrl: string | null;
  try {
    coverUrl = await findCoverImageURL(mangaUrl);
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "failed to resolve manga",
      },
      { status: 502 },
    );
  }

  if (!coverUrl) {
    return NextResponse.json(
      { error: "Could not resolve manga from URL" },
      { status: 404 },
    );
  }

  const slug = returnGlobFromURL(mangaUrl);
  const mangaName = slug
    ? slug
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ")
    : "Unknown Manga";

  return NextResponse.json({ mangaName, coverUrl });
}
