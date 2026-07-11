// /api/v1/proxy/image/route.ts
//
// Authenticated image proxy — exists solely to work around CORS.
//
// The scan-mirror CDNs (official.lowee.us, scans.lastation.us,
// hot.planeptune.us, ...) don't send `Access-Control-Allow-Origin`, so
// browser `fetch()` can't read their responses — every image fails with
// an opaque "Failed to fetch" TypeError before we even get to see the
// status code. MangaDex's image server (uploads.mangadex.org) DOES send
// CORS headers, so the client tries direct first and only falls back to
// this proxy when a host is known to block CORS (see
// lib/client/build-cbz-in-browser.ts).
//
// This route:
//   1. Authenticates the user (no open proxy).
//   2. Validates the URL is http(s).
//   3. Fetches it server-side with MIRROR_REQUEST_HEADERS (browser fetch
//      can't set User-Agent / Referer — they're forbidden headers — and
//      these CDNs 403/404 bare requests).
//   4. Streams the upstream response body straight back to the browser
//      with `Access-Control-Allow-Origin: *` so the browser can read it.
//
// We do NOT check that the URL is one we saved in `pages` — that would
// add a DB query per image (hundreds per manga), and the session check
// is already enough to prevent anonymous abuse. A logged-in user could
// technically use this to proxy arbitrary image URLs, but that's no
// worse than the old server-side build-cbz task which also fetched
// arbitrary URLs from the DB.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/get-session";
import { MIRROR_REQUEST_HEADERS } from "@/app/backend/manual/scrapping/mirrorProbe";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Single image fetch timeout — matches fetchImageBuffer in download.ts. */
const IMAGE_FETCH_TIMEOUT_MS = 20_000;

export async function GET(req: NextRequest) {
  // ── 1. Auth ────────────────────────────────────────────────────────
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ── 2. Parse + validate the target URL ─────────────────────────────
  const targetUrl = req.nextUrl.searchParams.get("url")?.trim();

  if (!targetUrl) {
    return NextResponse.json(
      { error: "url query parameter is required" },
      { status: 400 },
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return NextResponse.json(
      { error: "invalid url" },
      { status: 400 },
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return NextResponse.json(
      { error: "only http(s) urls are allowed" },
      { status: 400 },
    );
  }

  // ── 3. Fetch upstream with the same headers mirrorProbe uses ───────
  // The browser can't set User-Agent or Referer (forbidden headers), so
  // CDNs that require a real browser UA reject bare requests. We use the
  // exact same header set mirrorProbe.ts uses for its probing, keeping
  // behaviour consistent with the scrape stage.
  let upstream: Response;
  try {
    upstream = await fetch(parsed.href, {
      signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
      headers: MIRROR_REQUEST_HEADERS,
      // Don't send/receive cookies — these are third-party CDNs.
      credentials: "omit",
      // Follow redirects — some mirrors redirect to a CDN URL.
      redirect: "follow",
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: `upstream fetch failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    // Pass the upstream status through so the client can react to 429
    // etc. without fabricating a fake 502.
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
        "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
      },
    });
  }

  // ── 4. Stream the body back with CORS + cache headers ──────────────
  // Copy through content-type and content-length so the browser knows
  // what it's getting. Set a long browser cache so re-builds of the same
  // manga don't re-hit the proxy for every page — these images are
  // immutable (same URL = same bytes).
  const responseHeaders = new Headers();
  responseHeaders.set(
    "Content-Type",
    upstream.headers.get("content-type") ?? "application/octet-stream",
  );
  responseHeaders.set("Access-Control-Allow-Origin", "*");
  responseHeaders.set("Cache-Control", "private, max-age=3600");

  const contentLength = upstream.headers.get("content-length");
  if (contentLength) {
    responseHeaders.set("Content-Length", contentLength);
  }

  return new Response(upstream.body, {
    status: 200,
    headers: responseHeaders,
  });
}
