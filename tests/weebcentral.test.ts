import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchWeebCentralHtmlMock } = vi.hoisted(() => ({
  fetchWeebCentralHtmlMock: vi.fn(),
}));

vi.mock("@/app/backend/weebcentral/scrapping/weebcentralHttp", () => ({
  fetchWeebCentralHtml: fetchWeebCentralHtmlMock,
}));

import {
  discoverSeriesUrlFromChapterPage,
  getWeebCentralSeriesChapters,
  getWeebCentralSeriesTitle,
  isWeebCentralSeriesUrl,
  slugToTitle,
  weebCentralSeriesSlug,
} from "@/app/backend/weebcentral/scrapping/getSeriesChapterList";

describe("WeebCentral scraping helpers", () => {
  beforeEach(() => {
    fetchWeebCentralHtmlMock.mockReset();
  });

  it("detects series URLs", () => {
    expect(
      isWeebCentralSeriesUrl("https://weebcentral.com/series/abc123/my-slug"),
    ).toBe(true);
    expect(
      isWeebCentralSeriesUrl("https://weebcentral.com/chapters/abc123"),
    ).toBe(false);
    expect(isWeebCentralSeriesUrl("https://example.com/series/abc123")).toBe(
      false,
    );
  });

  it("builds a chapter list from the full-chapter-list endpoint", async () => {
    fetchWeebCentralHtmlMock.mockResolvedValueOnce(`
      <div>
        <div x-data="foo">
          <a href="/chapters/0001/001"><span class="flex"><span>Chapter 1</span></span></a>
        </div>
        <div x-data="bar">
          <a href="/chapters/0002/001"><span class="flex"><span>Chapter 2</span></span></a>
        </div>
      </div>
    `);

    await expect(
      getWeebCentralSeriesChapters(
        "https://weebcentral.com/series/abc123/my-slug",
      ),
    ).resolves.toEqual([
      { url: "https://weebcentral.com/chapters/0002/001", name: "Chapter 2" },
      { url: "https://weebcentral.com/chapters/0001/001", name: "Chapter 1" },
    ]);
  });

  it("extracts a title from the series page HTML", async () => {
    fetchWeebCentralHtmlMock.mockResolvedValueOnce(
      `<html><head><title>My Manga | WeebCentral</title></head><body><section x-data><h1>My Manga</h1></section></body></html>`,
    );

    await expect(
      getWeebCentralSeriesTitle(
        "https://weebcentral.com/series/abc123/my-slug",
      ),
    ).resolves.toBe("My Manga");
  });

  it("converts slugs to readable titles", () => {
    expect(slugToTitle("aishiteru-game-wo-owarasetai")).toBe(
      "Aishiteru Game Wo Owarasetai",
    );
    expect(slugToTitle("")).toBe("");
  });

  it("extracts the trailing slug from a series URL", () => {
    expect(
      weebCentralSeriesSlug("https://weebcentral.com/series/abc123/my-slug"),
    ).toBe("my-slug");
    expect(
      weebCentralSeriesSlug("https://weebcentral.com/series/abc123"),
    ).toBeNull();
  });

  it("discovers the series URL from a chapter page", async () => {
    fetchWeebCentralHtmlMock.mockResolvedValueOnce(
      `<html><body><a href="/series/abc123/my-slug">Series</a></body></html>`,
    );

    await expect(
      discoverSeriesUrlFromChapterPage(
        "https://weebcentral.com/chapters/abc123/001",
      ),
    ).resolves.toBe("https://weebcentral.com/series/abc123/my-slug");
  });
});
