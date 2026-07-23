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
//   2. Validates the URL is http(s) AND its hostname is one of the
//      known image hosts this app actually links to (see SSRF note
//      below).
//   3. Fetches it server-side with MIRROR_REQUEST_HEADERS (browser fetch
//      can't set User-Agent / Referer — they're forbidden headers — and
//      these CDNs 403/404 bare requests).
//   4. Streams the upstream response body straight back to the browser
//      with `Access-Control-Allow-Origin: *` so the browser can read it.
//
// SSRF NOTE: this previously accepted ANY http(s) URL from a signed-in
// user and fetched it server-side with `redirect: "follow"` — i.e. an
// authenticated user could point this at http://169.254.169.254/ (cloud
// metadata), http://localhost:<internal-port>/, or any other
// internal-only address this server's network can reach, and read the
// response back through an authenticated, CORS-open endpoint. "A logged
// in user could technically proxy arbitrary URLs" is not an acceptable
// trade-off for a server-side fetch primitive — it's a textbook SSRF.
// We don't need arbitrary URLs to work around CORS; we only ever need
// to fetch from the handful of hosts this app actually scrapes images
// from, so we allowlist exactly those.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/get-session";
import {
  MIRROR_BASE_URLS,
  MIRROR_REQUEST_HEADERS,
} from "@/app/backend/manual/scrapping/mirrorProbe";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Single image fetch timeout — matches fetchImageBuffer in download.ts. */
const IMAGE_FETCH_TIMEOUT_MS = 20_000;

/** Every hostname this proxy is allowed to fetch from. Derived from the
 *  known scan-mirror bases plus MangaDex's own image host (which the
 *  client normally fetches directly, but may still route through here
 *  in edge cases — cheap to allow, and it's a host we already trust). */
const ALLOWED_HOSTNAMES = new Set<string>([
  ...MIRROR_BASE_URLS.map((base) => new URL(base).hostname),
  "uploads.mangadex.org",
]);

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
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return NextResponse.json(
      { error: "only http(s) urls are allowed" },
      { status: 400 },
    );
  }

  if (!ALLOWED_HOSTNAMES.has(parsed.hostname)) {
    return NextResponse.json(
      { error: "this host is not a supported image source" },
      { status: 400 },
    );
  }

  // ── 3. Fetch upstream with the same headers mirrorProbe uses ───────
  // The browser can't set User-Agent or Referer (forbidden headers), so
  // CDNs that require a real browser UA reject bare requests. We use the
  // exact same header set mirrorProbe.ts uses for its probing, keeping
  // behaviour consistent with the scrape stage.
  //
  // redirect: "manual" + a manual hop-and-revalidate loop, rather than
  // fetch's own `redirect: "follow"` — a compromised/misconfigured
  // allowlisted host could otherwise 302 this request to a disallowed
  // (e.g. internal) address and we'd follow it blind. Each hop is
  // re-checked against the same hostname allowlist above.
  let currentUrl = parsed.href;
  let upstream: Response;
  const MAX_REDIRECTS = 5;

  try {
    let hop = 0;
    for (;;) {
      const res = await fetch(currentUrl, {
        signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
        headers: MIRROR_REQUEST_HEADERS,
        credentials: "omit",
        redirect: "manual",
      });

      const isRedirect = res.status >= 300 && res.status < 400;
      if (!isRedirect) {
        upstream = res;
        break;
      }

      if (hop++ >= MAX_REDIRECTS) {
        return NextResponse.json(
          { error: "too many redirects" },
          { status: 502 },
        );
      }

      const location = res.headers.get("location");
      if (!location) {
        return NextResponse.json(
          { error: "redirect with no location header" },
          { status: 502 },
        );
      }

      const nextUrl = new URL(location, currentUrl);
      if (
        (nextUrl.protocol !== "http:" && nextUrl.protocol !== "https:") ||
        !ALLOWED_HOSTNAMES.has(nextUrl.hostname)
      ) {
        return NextResponse.json(
          { error: "redirect target is not an allowed host" },
          { status: 502 },
        );
      }

      currentUrl = nextUrl.href;
    }
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
        "Content-Type":
          upstream.headers.get("content-type") ?? "application/octet-stream",
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

  if (!upstream.ok) {
    // Pass the upstream status through so the client can react to 429
    // etc. without fabricating a fake 502.
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
        "Content-Type":
          upstream.headers.get("content-type") ?? "application/octet-stream",
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
