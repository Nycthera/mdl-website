"use server";

import { createAdminClient } from "@/lib/supabase/server";

export interface Manga {
  id: number;
  manga_name: string;
  date_last_checked: number;
  latest_chapter_local: number;
  latest_chapter_from_mangadex: number;
  mangadex_id: string | null;
}

export async function getMangaLibrary(): Promise<Manga[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("manga_data")
    .select(
      "id, manga_name, date_last_checked, latest_chapter_local, latest_chapter_from_mangadex, mangadex_id",
    )
    .order("manga_name", { ascending: true });

  if (error) throw new Error(error.message);

  return data ?? [];
}

/** Sets (or clears, if mangadexId is null) the MangaDex series a
 *  manga_data row should be checked against. */
export async function setMangaDataMangadexId(
  mangaDataId: number,
  mangadexId: string | null,
): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("manga_data")
    .update({ mangadex_id: mangadexId })
    .eq("id", mangaDataId);

  if (error) throw new Error(error.message);
}

/** Fetches only the fields the checker needs, for a specific set of
 *  manga_data ids, filtered to rows that actually have a mangadex_id
 *  linked (unlinked rows are silently skipped rather than erroring —
 *  lets "Check all" be called without the caller pre-filtering). */
export async function getMangaDataForCheck(
  ids: number[],
): Promise<Pick<Manga, "id" | "manga_name" | "mangadex_id">[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("manga_data")
    .select("id, manga_name, mangadex_id")
    .in("id", ids)
    .not("mangadex_id", "is", null);

  if (error) throw new Error(error.message);

  return data ?? [];
}

/** Writes a check result back onto a manga_data row. */
export async function updateMangaDataCheckResult(
  mangaDataId: number,
  latestChapter: number,
): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("manga_data")
    .update({
      latest_chapter_from_mangadex: latestChapter,
      date_last_checked: Math.floor(Date.now() / 1000),
    })
    .eq("id", mangaDataId);

  if (error) throw new Error(error.message);
}

export async function getMangaBehind(): Promise<Manga[]> {
  const library = await getMangaLibrary();

  return library
    .filter((m) => m.latest_chapter_from_mangadex > m.latest_chapter_local)
    .sort((a, b) => a.manga_name.localeCompare(b.manga_name));
}

export async function getMangaStats(): Promise<{
  total: number;
  upToDate: number;
  behind: number;
}> {
  const library = await getMangaLibrary();

  const behind = library.filter(
    (m) => m.latest_chapter_from_mangadex > m.latest_chapter_local,
  ).length;

  return {
    total: library.length,
    upToDate: library.length - behind,
    behind,
  };
}
