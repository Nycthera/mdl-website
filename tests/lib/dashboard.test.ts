import { describe, expect, it } from "vitest";

import {
  formatDashboardDate,
  getMangaStatus,
  summarizeLibrary,
} from "@/lib/dashboard";

describe("dashboard helpers", () => {
  it("derives a status from local and remote chapters", () => {
    expect(
      getMangaStatus({
        latest_chapter_local: 4,
        latest_chapter_from_mangadex: 4,
      }),
    ).toBe("up-to-date");

    expect(
      getMangaStatus({
        latest_chapter_local: 3,
        latest_chapter_from_mangadex: 5,
      }),
    ).toBe("behind");
  });

  it("summarizes library health and sorts the most behind titles first", () => {
    const summary = summarizeLibrary([
      {
        id: 1,
        manga_name: "Alpha",
        date_last_checked: 1700000000,
        latest_chapter_local: 10,
        latest_chapter_from_mangadex: 12,
      },
      {
        id: 2,
        manga_name: "Beta",
        date_last_checked: 1800000000,
        latest_chapter_local: 8,
        latest_chapter_from_mangadex: 8,
      },
      {
        id: 3,
        manga_name: "Gamma",
        date_last_checked: 1750000000,
        latest_chapter_local: 1,
        latest_chapter_from_mangadex: 6,
      },
    ]);

    expect(summary.total).toBe(3);
    expect(summary.upToDate).toBe(1);
    expect(summary.behind).toBe(2);
    expect(summary.totalGap).toBe(7);
    expect(summary.mostBehind[0].manga_name).toBe("Gamma");
    expect(summary.recentlyChecked[0].manga_name).toBe("Beta");
  });

  it("formats dates in the dashboard locale", () => {
    expect(formatDashboardDate(1704067200)).toBe("1 Jan 2024");
  });
});
