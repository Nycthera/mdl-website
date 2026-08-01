import { beforeEach, describe, expect, it, vi } from "vitest";

const { clientGetMock } = vi.hoisted(() => ({
  clientGetMock: vi.fn(),
}));

vi.mock("axios", () => ({
  default: {
    create: vi.fn(() => ({
      get: clientGetMock,
    })),
  },
}));

import {
  MIRROR_BASE_URLS,
  MIRROR_REQUEST_HEADERS,
  checkMirrorUrl,
  findWorkingMirrorUrl,
  mirrorBaseFromUrl,
  probeChapterPages,
} from "@/app/backend/manual/scrapping/mirrorProbe";

describe("mirror probing helpers", () => {
  beforeEach(() => {
    clientGetMock.mockReset();
  });

  it("exposes the mirror constants and header values", () => {
    expect(MIRROR_BASE_URLS).toHaveLength(4);
    expect(MIRROR_REQUEST_HEADERS).toMatchObject({
      Referer: "https://mangadex.org/",
      Accept: expect.stringContaining("image/avif"),
    });
  });

  it("checks a mirror URL and uses response status", async () => {
    clientGetMock.mockResolvedValueOnce({ status: 200 });
    await expect(checkMirrorUrl("https://example.com/test.png")).resolves.toBe(true);
    await expect(checkMirrorUrl("https://example.com/not-here.png")).resolves.toBe(false);
  });

  it("finds the first working mirror url", async () => {
    clientGetMock.mockResolvedValueOnce({ status: 404 });
    clientGetMock.mockResolvedValueOnce({ status: 200 });

    await expect(findWorkingMirrorUrl(["https://one.example/test.png", "https://two.example/test.png"])).resolves.toBe(
      "https://two.example/test.png",
    );
  });

  it("returns the matching mirror base for a known URL", () => {
    expect(mirrorBaseFromUrl("https://scans.lastation.us/manga/foo/001-001.png")).toBe(
      "https://scans.lastation.us/manga/",
    );
    expect(mirrorBaseFromUrl("https://example.com/manga/foo")).toBeNull();
  });

  it("probes chapter pages using the sticky base when available", async () => {
    clientGetMock.mockResolvedValueOnce({ status: 200 });
    clientGetMock.mockResolvedValueOnce({ status: 404 });
    clientGetMock.mockResolvedValueOnce({ status: 200 });
    clientGetMock.mockResolvedValueOnce({ status: 404 });
    clientGetMock.mockResolvedValueOnce({ status: 404 });
    clientGetMock.mockResolvedValueOnce({ status: 404 });

    const result = await probeChapterPages(
      "Wistoria-Wand-and-Sword",
      "0049",
      1,
      "https://scans.lastation.us/manga/",
      2,
      1,
    );

    expect(result.urls).toEqual([
      "https://scans.lastation.us/manga/Wistoria-Wand-and-Sword/0049-001.png",
      "https://scans.lastation.us/manga/Wistoria-Wand-and-Sword/0049-002.png",
    ]);
    expect(result.stickyBase).toBe("https://scans.lastation.us/manga/");
  });
});
