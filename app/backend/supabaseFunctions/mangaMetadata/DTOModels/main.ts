export interface MangaDTO {
  id: string;
  source: "mangadex" | "weebcentral";
  sourceMangaId: string;
  title: string;
  coverUrl: string;
}

export interface ChapterDTO {
  id: string;
  mangaId: string;
  chapterNumber: string;
  title?: string;
  pageCount: number;
}

export interface PageDTO {
  id: string;
  chapterId: string;
  pageNumber: number;
  imageUrl: string;
}
