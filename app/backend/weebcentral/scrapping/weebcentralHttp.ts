// app/backend/weebcentral/scrapping/weebcentralHttp.ts
//
// Shared plain-HTTP client + Cloudflare-challenge detection for every
// WeebCentral page we fetch (chapter pages, the /images sub-route, and
// series chapter-list pages). Pulled out so the series-discovery logic and
// the per-chapter image logic don't each reimplement retry/backoff.
import axios from "axios";

export const client = axios.create({
  timeout: 15_000,
  validateStatus: () => true,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
  },
});

/** Crude Cloudflare-challenge sniff, mirroring the Python reference's
 *  `_fetch_html`. We don't have a FlareSolverr instance available here, so
 *  on a real challenge we just fail with a clear, specific error instead
 *  of silently returning an empty/garbage page. */
function looksLikeCloudflareChallenge(status: number, html: string): boolean {
  if (status === 403 || status === 503) return true;
  return (
    html.includes("<title>Just a moment...</title>") ||
    html.includes("Enable JavaScript and cookies to continue") ||
    (html.toLowerCase().includes("cloudflare") &&
      html.toLowerCase().includes("challenge"))
  );
}

/** GET any WeebCentral URL and return its raw HTML, with 429/backoff
 *  handling and Cloudflare-challenge detection. */
export async function fetchWeebCentralHtml(
  url: string,
  maxRetries = 3
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await client.get(url);

      if (res.status === 429) {
        const retryAfter = Number(res.headers["retry-after"]) || attempt * 5;
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        continue;
      }

      const html: string = typeof res.data === "string" ? res.data : "";

      if (looksLikeCloudflareChallenge(res.status, html)) {
        throw new Error(
          "WeebCentral returned a Cloudflare challenge page — this source " +
            "can't be scraped without a JS-challenge solver right now."
        );
      }

      if (res.status !== 200) {
        throw new Error(`WeebCentral returned ${res.status} for ${url}`);
      }

      return html;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to fetch WeebCentral page: ${url}`);
}
