export interface DashboardManga {
  id: number;
  manga_name: string;
  date_last_checked: number;
  latest_chapter_local: number;
  latest_chapter_from_mangadex: number;
}

export type MangaStatus = "up-to-date" | "behind";

export interface MangaInsight extends DashboardManga {
  chapterGap: number;
}

export interface LibrarySummary {
  total: number;
  upToDate: number;
  behind: number;
  totalGap: number;
  mostBehind: MangaInsight[];
  recentlyChecked: MangaInsight[];
}

export function formatDashboardDate(unixSeconds: number) {
  return new Date(unixSeconds * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function getMangaStatus(
  manga: Pick<
    DashboardManga,
    "latest_chapter_local" | "latest_chapter_from_mangadex"
  >,
): MangaStatus {
  if (manga.latest_chapter_local < manga.latest_chapter_from_mangadex) {
    return "behind";
  }

  return "up-to-date";
}

function enrichManga(manga: DashboardManga): MangaInsight {
  return {
    ...manga,
    chapterGap: Math.max(
      0,
      manga.latest_chapter_from_mangadex - manga.latest_chapter_local,
    ),
  };
}

export function summarizeLibrary(manga: DashboardManga[]): LibrarySummary {
  const enriched = manga.map(enrichManga);
  const behind = enriched.filter((item) => item.chapterGap > 0);
  const mostBehind = [...behind].sort((a, b) => {
    if (b.chapterGap !== a.chapterGap) return b.chapterGap - a.chapterGap;
    return a.manga_name.localeCompare(b.manga_name);
  });
  const recentlyChecked = [...enriched].sort((a, b) => {
    if (b.date_last_checked !== a.date_last_checked) {
      return b.date_last_checked - a.date_last_checked;
    }

    return a.manga_name.localeCompare(b.manga_name);
  });

  return {
    total: enriched.length,
    upToDate: enriched.length - behind.length,
    behind: behind.length,
    totalGap: behind.reduce((sum, item) => sum + item.chapterGap, 0),
    mostBehind: mostBehind.slice(0, 4),
    recentlyChecked: recentlyChecked.slice(0, 4),
  };
}
