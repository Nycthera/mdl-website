import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGet } = vi.hoisted(() => ({
  mockGet: vi.fn(),
}));
vi.mock("axios", () => ({
  default: {
    get: mockGet,
  },
}));

import {
  createFolderForManga,
  defineTypeOfURL,
  extractMangaDexUUID,
  getChapterIDForMangaDex,
  getChapterIdFromURLWeebCentral,
  getMangaDexInfoFromURL,
  returnGlobFromURL,
  sanitizeFileName,
  slugify,
  validateMangaURL,
} from "@/app/backend/utils";

describe("backend URL helpers", () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it("validates supported manga URLs", () => {
    expect(
      validateMangaURL(
        "https://mangadex.org/title/123e4567-e89b-12d3-a456-426614174000/test-slug",
      ),
    ).toBe(true);
    expect(validateMangaURL("https://weebcentral.com/chapters/abc123")).toBe(
      true,
    );
    expect(validateMangaURL("https://weebcentral.com/series/abc123")).toBe(
      true,
    );
    expect(
      validateMangaURL("https://scans.lastation.us/manga/foo/0001-001.png"),
    ).toBe(true);
    expect(validateMangaURL("https://example.com")).toBe(false);
  });

  it("classifies URLs by source", () => {
    expect(
      defineTypeOfURL(
        "https://mangadex.org/title/123e4567-e89b-12d3-a456-426614174000/test-slug",
      ),
    ).toBe("mangadex");
    expect(defineTypeOfURL("https://weebcentral.com/series/abc123")).toBe(
      "weebcentral",
    );
    expect(
      defineTypeOfURL("https://scans.lastation.us/manga/foo/0001-001.png"),
    ).toBe("manual");
    expect(defineTypeOfURL("https://example.com")).toBeNull();
  });

  it("extracts info from MangaDex URLs", () => {
    expect(
      getMangaDexInfoFromURL(
        "https://mangadex.org/title/123e4567-e89b-12d3-a456-426614174000/my-slug",
      ),
    ).toEqual({
      id: "123e4567-e89b-12d3-a456-426614174000",
      name: "My Slug",
    });

    expect(getMangaDexInfoFromURL("https://mangadex.org/not-a-title")).toEqual({
      id: "Unknown ID",
      name: "Unknown Manga",
    });
  });

  it("slugifies and sanitizes values", () => {
    expect(slugify("Kakkou No Iinazuke")).toBe("kakkou-no-iinazuke");
    expect(slugify("Café de la Vie")).toBe("cafe-de-la-vie");
    expect(sanitizeFileName("bad<name>:/\\|?*")).toBe("badname");
  });

  it("extracts IDs and chapter identifiers from URLs", () => {
    expect(
      extractMangaDexUUID(
        "https://mangadex.org/title/123e4567-e89b-12d3-a456-426614174000/my-slug",
      ),
    ).toBe("123e4567-e89b-12d3-a456-426614174000");
    expect(extractMangaDexUUID("https://example.com")).toBeNull();
    expect(
      getChapterIdFromURLWeebCentral(
        "https://weebcentral.com/chapters/abc/123",
      ),
    ).toBe("abc/123");
    expect(
      getChapterIdFromURLWeebCentral("https://example.com/not-a-chapter/abc"),
    ).toBe("Unknown Chapter ID");
  });

  it("returns the correct glob and folder names", () => {
    expect(
      returnGlobFromURL(
        "https://scans.lastation.us/manga/Wistoria-Wand-and-Sword/0065-001.png",
      ),
    ).toBe("Wistoria-Wand-and-Sword");
    expect(returnGlobFromURL("https://example.com")).toBeNull();
    expect(createFolderForManga("My  Manga  Name")).toBe("my_manga_name");
  });

  it("fetches the first chapter id from MangaDex", async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        data: [{ id: "chapter-001" }],
      },
    });

    await expect(
      getChapterIDForMangaDex("https://mangadex.org/title/123", "manga-123"),
    ).resolves.toBe("chapter-001");
    expect(mockGet).toHaveBeenCalledWith(
      "https://api.mangadex.org/manga/manga-123/feed",
      expect.objectContaining({
        params: {
          "translatedLanguage[]": "en",
          limit: 1,
          "order[chapter]": "asc",
        },
      }),
    );
  });
});
