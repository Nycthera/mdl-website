import { returnGlobFromURL } from "@/app/backend/utils";
import {
  MIRROR_BASE_URLS,
  checkMirrorUrl,
} from "@/app/backend/manual/scrapping/mirrorProbe";

/**
 * Finds the cover (page 1 of chapter 1) for a manga slug across the known
 * scan mirrors. Reuses checkMirrorUrl from mirrorProbe.ts rather than
 * rolling its own axios call — that used to duplicate the mirror list,
 * headers, and a GET-as-existence-check that never consumed its response
 * stream, which let axios's timeout kill an abandoned stream and throw an
 * uncaught 'error' event ~8s after a request that had already succeeded.
 * checkMirrorUrl now does a HEAD check (no body ever transferred) with a
 * safe, stream-draining GET fallback — fixed once, shared everywhere.
 */
export async function findCoverImageURL(
  inputUrl: string,
): Promise<string | null> {
  const mangaSlug = returnGlobFromURL(inputUrl);

  if (!mangaSlug) {
    return null;
  }

  for (const baseUrl of MIRROR_BASE_URLS) {
    const candidateUrl = `${baseUrl}${mangaSlug}/0001-001.png`;

    const ok = await checkMirrorUrl(candidateUrl);
    console.log(
      `[findCoverImageURL] ${candidateUrl} -> ${ok ? "found" : "miss"}`,
    );

    if (ok) {
      return candidateUrl;
    }
  }

  return null;
}
