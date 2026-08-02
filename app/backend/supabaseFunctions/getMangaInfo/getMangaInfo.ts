"use server";

import { createAdminClient } from "@/lib/supabase/server";

export interface Manga {
  id: number;
  manga_name: string;
  date_last_checked: number;
  latest_chapter_local: number;
  latest_chapter_from_mangadex: number;
}

export async function getMangaLibrary(): Promise<Manga[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("manga_data")
    .select(
      "id, manga_name, date_last_checked, latest_chapter_local, latest_chapter_from_mangadex",
    )
    .order("manga_name", { ascending: true });

  if (error) throw new Error(error.message);

  return data ?? [];
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
