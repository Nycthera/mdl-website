"use server";

import { createClient } from "@/lib/supabase/server";

export interface Manga {
  id: number;
  manga_name: string;
  date_last_checked: number;
  latest_chapter_local: number;
  latest_chapter_from_mangadex: number;
}

export async function getMangaLibrary(): Promise<Manga[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("manga_data")
    .select("id, manga_name, date_last_checked, latest_chapter_local, latest_chapter_from_mangadex")
    .order("manga_name", { ascending: true });

  if (error) throw new Error(error.message);

  return data ?? [];
}

export async function getMangaBehind(): Promise<Manga[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("manga_data")
    .select("id, manga_name, date_last_checked, latest_chapter_local, latest_chapter_from_mangadex")
    .filter("latest_chapter_local", "lt", "latest_chapter_from_mangadex")
    .order("manga_name", { ascending: true });

  if (error) throw new Error(error.message);

  return data ?? [];
}

export async function getMangaStats(): Promise<{
  total: number;
  upToDate: number;
  behind: number;
}> {
  const supabase = await createClient();

  const [{ count: total }, { count: behind }] = await Promise.all([
    supabase.from("manga_data").select("*", { count: "exact", head: true }),
    supabase
      .from("manga_data")
      .select("*", { count: "exact", head: true })
      .filter("latest_chapter_local", "lt", "latest_chapter_from_mangadex"),
  ]);

  const safeTotal = total ?? 0;
  const safeBehind = behind ?? 0;

  return {
    total: safeTotal,
    upToDate: safeTotal - safeBehind,
    behind: safeBehind,
  };
}