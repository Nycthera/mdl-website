import { describe, expect, it } from "vitest";

import {
  getCbzFilename,
  groupUrlsByChapter,
} from "@/app/backend/downloadLogicForManualAndWeebcentral/download";

describe("download archive helpers", () => {
  it("builds a CBZ filename from the manga title", () => {
    expect(getCbzFilename("My Manga Name")).toBe("My Manga Name.cbz");
  });

  it("groups flat image URLs into chapter buckets", () => {
    const urls = [
      "https://example.com/0001-001.png",
      "https://example.com/0001-002.png",
      "https://example.com/0002-001.png",
      "https://example.com/0049.1-001.png",
    ];

    expect(groupUrlsByChapter(urls)).toEqual([
      { label: "0001", imageUrls: ["https://example.com/0001-001.png", "https://example.com/0001-002.png"] },
      { label: "0002", imageUrls: ["https://example.com/0002-001.png"] },
      { label: "0049.1", imageUrls: ["https://example.com/0049.1-001.png"] },
    ]);
  });
});
